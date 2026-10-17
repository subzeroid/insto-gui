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
        self.assertEqual(pin["core_version"], "0.7.25")
        self.assertEqual(pin["core_commit"], "dcb082c1eb4792a56df93bc3787028d22311cd51")
        self.assertIn(f'pub const CORE_VERSION: &str = "{pin["core_version"]}";', protocol)
        self.assertIn(f"export const CORE_VERSION = '{pin['core_version']}'", client)
        table = re.search(r"pub const CAPABILITIES: \[&str; (\d+)\] = \[(.*?)\];", protocol, re.S)
        self.assertIsNotNone(table)
        self.assertEqual(int(table.group(1)), len(pin["capabilities"]))
        self.assertEqual(re.findall(r'"([a-z.]+)"', table.group(2)), pin["capabilities"])
        self.assertEqual(len(set(pin["capabilities"])), 29)


if __name__ == "__main__":
    unittest.main()
