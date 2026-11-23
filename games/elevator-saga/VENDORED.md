# Elevator Saga
Source: https://github.com/magwo/elevatorsaga
Pinned commit: e0c55bf8cf59243c32dc371b2cc7b2e3ec1664af
Copyright Magnus Wolffelt and contributors; MIT (LICENSE.txt).
Local adaptation: opaque allow-scripts sandbox; all executable upstream code, styles and fonts are inert JSON until embedded in srcdoc. Removed analytics, Google Fonts, external/help/test links. Session-only saves replace localStorage; reload loses progress. Starter visits all three floors. Upstream challenges, simulation, editor and Run/Apply are retained.
Third-party dependencies: jQuery 2.1.1 (MIT), Lodash (MIT), Riot (MIT), CodeMirror (MIT), Font Awesome 4.1 (font SIL OFL 1.1; CSS MIT), unobservable (upstream library). Original bundled copyright/license headers retained inside payload.json. See THIRD_PARTY_NOTICES.txt for bundled license files.
No second executable HTML entry, parent eval, storage bridge, external runtime, telemetry or soundtrack. Infinite user scripts can still consume CPU; close/reload the tab. Source redistribution is the human-readable JSON payload, not an unsandboxed runner.
