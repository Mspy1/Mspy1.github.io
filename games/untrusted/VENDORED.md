# Untrusted — NONCOMMERCIAL ONLY
Source: https://github.com/AlexNisnevich/untrusted
Pinned commit: ab4a8ed28058a3f4b53cc48972b756ef9c97e862
By Alex Nisnevich and Greg Shuflin and contributors.
Distributed adaptation under CC BY-NC-SA 3.0: https://creativecommons.org/licenses/by-nc-sa/3.0/
Noncommercial use only; share adaptations under the same license with attribution. Commercial license requires separate permission from authors; omission of music does NOT grant commercial permission. Published here as a noncommercial arcade game.
Soundtrack and sound effects entirely omitted; sound API is a no-op. No music licenses asserted.
All 22 main levels and bonus levels plus inspectable/editable game scripts bundled as inert JSON. Runtime text loading uses an exact-key in-memory dictionary, not fetch or arbitrary URLs. Removed gist upload method/calls and credential-bearing upstream code, analytics, Google Fonts, external jQuery, ribbon, donation form. Session-only saves (reload loses progress).
Compatibility change: original nested about:blank validator was replaced by eval in the OUTER OPAQUE sandbox, never the trusted launcher; upstream validation/game-object restrictions remain, but are gameplay checks, not a security boundary. The outer browser sandbox is the security boundary. No allow-same-origin, forms, popups, navigation privilege, network, workers, parent eval or storage bridge. Long-running scripts may hang the tab.
Libraries: jQuery 2.1.1 (MIT, locally reused from Elevator Saga), CodeMirror 3.1 (MIT), ROT.js (BSD), es5-shim (MIT), shortcut.js (BSD). Original source headers retained in payload.json; license files collected in THIRD_PARTY_NOTICES.txt. README-LICENSE.md contains upstream attribution/license statement. Modified readable source is embedded in payload.json; no executable secondary HTML entry is shipped.
Full campaign progression requires browser validation; report any limitations rather than weakening isolation.
