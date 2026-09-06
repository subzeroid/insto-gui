"""The core pin, the Rust host constants and the Vue constant must agree."""

import json
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


class CorePinConsistency(unittest.TestCase):
    def test_pin_matches_host_and_frontend_constants(self):
        pin = json.loads((REPO / "packaging/core-pin.json").read_text())
        protocol = (REPO / "crates/desktop-host/src/protocol.rs").read_text()
        client = (REPO / "src/desktop/client.ts").read_text()
        self.assertEqual(pin["core_version"], "0.7.21")
        self.assertEqual(pin["core_commit"], "7a1872568bd90a642a3df838fd9854286f251d03")
        self.assertIn(f'pub const CORE_VERSION: &str = "{pin["core_version"]}";', protocol)
        self.assertIn(f"export const CORE_VERSION = '{pin['core_version']}'", client)
        table = re.search(r"pub const CAPABILITIES: \[&str; (\d+)\] = \[(.*?)\];", protocol, re.S)
        self.assertIsNotNone(table)
        self.assertEqual(int(table.group(1)), len(pin["capabilities"]))
        self.assertEqual(sorted(re.findall(r'"([a-z.]+)"', table.group(2))), sorted(pin["capabilities"]))
        self.assertEqual(len(set(pin["capabilities"])), 19)


if __name__ == "__main__":
    unittest.main()
