# insto-gui

Self-contained macOS monitoring app under development. The local P1 shell
provides token setup and service controls around a bundled insto core.
Account management and history screens are not implemented yet.

The app will bundle a compatible Python insto core. Users will not install
Python, uv or the CLI separately. There is no public installer or release yet.
Developer packaging commands live in
[packaging/README.md](packaging/README.md) and are not user installation instructions.

Current evidence and remaining gates: [P1 app proof](packaging/app-proof-results.md).
