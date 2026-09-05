import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import probe_runtime as proof
from scripts.runtime_manifest import describe


class HandshakeTests(unittest.TestCase):
    def setUp(self):
        self.envelope = {
            "protocol_version": 1,
            "request_id": "packaging-proof",
            "result": {
                "capabilities": ["hello"],
                "schema_version_supported": 2,
                "core_version": "0.7.20",
            },
        }

    def response(self, envelope=None, stderr=b"", suffix=b"\n"):
        return subprocess.CompletedProcess(
            [], 0, json.dumps(envelope or self.envelope).encode() + suffix, stderr
        )

    def test_handshake_isolated_argv_environment_and_protocol(self):
        with patch.object(
            proof.subprocess, "run", return_value=self.response()
        ) as call:
            self.assertEqual(
                proof.handshake(Path("/runtime/python"), Path("/probe")),
                self.envelope["result"],
            )
        args, kwargs = call.call_args
        self.assertEqual(
            args[0], ["/runtime/python", "-I", "-B", "-m", "insto.desktop"]
        )
        self.assertEqual(kwargs["env"], proof.ENV)
        self.assertEqual(set(kwargs["env"]), {"PATH", "LANG"})
        self.assertEqual(kwargs["timeout"], 10)
        self.assertTrue(kwargs["check"])
        request = json.loads(kwargs["input"])
        self.assertEqual(
            request,
            {
                "protocol_version": 1,
                "request_id": "packaging-proof",
                "operation": "hello",
                "params": {},
            },
        )

    def test_rejects_invalid_transport_and_envelopes(self):
        envelopes = [
            [],
            {**self.envelope, "protocol_version": True},
            {**self.envelope, "request_id": "wrong"},
            {**self.envelope, "error": {}},
            {**self.envelope, "result": []},
            {
                **self.envelope,
                "result": {"capabilities": "hello", "schema_version_supported": 2},
            },
            {
                **self.envelope,
                "result": {**self.envelope["result"], "schema_version_supported": 3},
            },
            {
                **self.envelope,
                "result": {**self.envelope["result"], "core_version": ""},
            },
        ]
        responses = [
            subprocess.CompletedProcess([], 0, json.dumps(value).encode() + b"\n", b"")
            for value in envelopes
        ]
        responses += [
            self.response(stderr=b"warning"),
            self.response(suffix=b"\n\n"),
            self.response(suffix=b""),
            subprocess.CompletedProcess([], 0, b"x" * (2 * 1024**2 + 1), b""),
        ]
        for response in responses:
            with self.subTest(response=response.stdout[:80]):
                with patch.object(proof.subprocess, "run", return_value=response):
                    with self.assertRaises(ValueError):
                        proof.handshake(Path("/runtime/python"), Path("/probe"))


class RelocationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.payload = self.root / "payload"
        self.runtime = self.payload / "python"
        (self.runtime / "bin").mkdir(parents=True)
        (self.runtime / "bin/python3").write_text("not executed")
        self.manifest = {
            "manifest_version": 1,
            "inputs": {
                "python_version": "3.12.14",
                "architecture": "arm64",
                "core_commit": "abc",
            },
            "files": describe(self.runtime),
        }
        self.write_manifest()
        self.hello = {"core_version": "0.7.20"}

    def write_manifest(self):
        self.manifest.pop("build_id", None)
        self.manifest["build_id"] = hashlib.sha256(
            json.dumps(self.manifest, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        (self.payload / "manifest.json").write_text(json.dumps(self.manifest))

    def dependency_result(self, command, **kwargs):
        python = Path(command[0])
        self.assertEqual(command[1:4], ["-I", "-B", "-c"])
        self.assertEqual(kwargs["env"], proof.ENV)
        details = {
            "python": "3.12.14",
            "architecture": "arm64",
            "core_version": "0.7.20",
            "origin": str(
                python.parent.parent / "lib/python3.12/site-packages/insto/__init__.py"
            ),
            "hikerapi_version": "test",
        }
        return subprocess.CompletedProcess([], 0, json.dumps(details).encode(), b"")

    def test_copies_to_space_path_and_records_evidence_without_native(self):
        with (
            patch.object(proof, "handshake", return_value=self.hello),
            patch.object(proof.subprocess, "run", side_effect=self.dependency_result),
            patch.object(proof, "run_native") as native,
        ):
            result = proof.probe(self.payload)
        native.assert_not_called()
        self.assertIn(" ", result.name)
        self.assertTrue((result / "different path/python/bin/python3").is_file())
        evidence = json.loads((result / "evidence.json").read_text())
        self.assertEqual(evidence["native"], "not_run")
        self.assertEqual(evidence["build_id"], self.manifest["build_id"])

    def test_invalid_manifest_or_inventory_never_executes(self):
        for change in ("identifier", "inventory"):
            with self.subTest(change=change):
                self.write_manifest()
                if change == "identifier":
                    value = dict(self.manifest, build_id="bad")
                    (self.payload / "manifest.json").write_text(json.dumps(value))
                else:
                    (self.runtime / "extra").touch()
                with patch.object(proof, "handshake") as hello:
                    with self.assertRaises(ValueError):
                        proof.probe(self.payload)
                hello.assert_not_called()

    def test_changed_runtime_after_execution_fails_and_retains_tree(self):
        def mutate(python, cwd):
            (python.parent / "new.pyc").touch()
            return self.hello

        with (
            patch.object(proof, "handshake", side_effect=mutate),
            patch.object(proof.subprocess, "run", side_effect=self.dependency_result),
        ):
            with self.assertRaises(ValueError):
                proof.probe(self.payload)
        roots = list(self.root.glob("relocated proof *"))
        self.assertEqual(len(roots), 1)
        self.assertTrue((roots[0] / "different path/python/bin/new.pyc").exists())
        self.assertFalse((roots[0] / "evidence.json").exists())

    def test_native_rejects_different_or_dirty_core(self):
        for state in ("dirty", "different"):
            with self.subTest(state=state):
                with (
                    patch.object(proof, "handshake", return_value=self.hello),
                    patch.object(
                        proof.subprocess, "run", side_effect=self.dependency_result
                    ),
                    patch.object(
                        proof, "core_identity", return_value=(state == "dirty", "other")
                    ),
                    patch.object(proof, "run_native") as native,
                ):
                    with self.assertRaises(ValueError):
                        proof.probe(self.payload, self.root)
                native.assert_not_called()

    def test_native_failure_retains_runtime_and_does_not_write_pass(self):
        with (
            patch.object(proof, "handshake", return_value=self.hello),
            patch.object(proof.subprocess, "run", side_effect=self.dependency_result),
            patch.object(proof, "core_identity", return_value=(False, "abc")),
            patch.object(
                proof, "run_native", side_effect=RuntimeError("cleanup failed")
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "cleanup failed"):
                proof.probe(self.payload, self.root)
        roots = list(self.root.glob("relocated proof *"))
        self.assertEqual(len(roots), 1)
        self.assertTrue((roots[0] / "different path/python/bin/python3").exists())
        self.assertFalse((roots[0] / "evidence.json").exists())


if __name__ == "__main__":
    unittest.main()
