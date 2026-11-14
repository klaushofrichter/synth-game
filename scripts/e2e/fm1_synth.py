"""Browser check for FM-1 Synth on a real games-service Table Host: the board page and one phone (at the smallest
supported size, 320 x 568) go through the platform's lobby, and the board runs the emulator.

Checks on the way:
  - no browser console error or uncaught exception, on the board or the phone;
  - the lobby's way in: the player joins, marks ready, the game starts with the player on South;
  - the board boots the FM-1's first firmware (downloaded from its author's site, as on a table) and says it runs, on
    the board and on the phone; the panel is drawn; a touch on a key lights it;
  - the phone layout rules of games-service (D-065);
  - a star in the firmware window puts that firmware first the next time it opens, and the phone keeps it (E-013);
  - the firmware window's SMK-37 tab switches the board to the SMK-37 (E-006, E-011); when its first firmware cannot
    be downloaded, the board plays the next one and says so, marks it in the window, and a tap tries it again (E-015);
    a firmware whose package is gone is left out of the board's window and the phone's list (E-016);
  - the phone switches the device back; facing north turns the bar, the panel and the seat plate in place (E-007,
    E-008) without moving them;
  - Finish asks first: Keep playing goes back to the game; Finish ends it with a summary naming what was played.

The firmwares come from their authors' sites (thefirmwarehub.com, genkigenki.github.io), so this check needs the
internet, as a table does; which ones it plays comes from the game's catalogs, not from this check. Starts its own Table Host from .games-service with GAMES_DIR pointing at this repo's games/.
  python3 scripts/e2e/fm1_synth.py out/
"""
import json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, ".games-service", "scripts", "e2e"))
from playwright.sync_api import sync_playwright  # noqa: E402
from common import errors, pick_game, start_table, watch, wait  # noqa: E402
from game_check import CHECK, TableCheck  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8096
BASE = f"http://127.0.0.1:{PORT}"
KEY = "e2ekey"
T = TableCheck(BASE, KEY, OUT, "fm1-synth", CHECK)
a, shot, check, phone, problems = T.a, T.shot, T.check, T.phone, T.problems
# 404s from the firmwares' sites: a package that is gone (or refused here on purpose) is the game's to handle (E-015,
# E-016), so the browser's console message about each is expected; a 404 from the table itself is not.
outside_404 = []  # (page label, url)
EMU = os.path.join(ROOT, "games", "fm1-synth", "assets", "emu")


def catalog(device):
    with open(os.path.join(EMU, f"firmwares-{device}.json")) as fh:
        return json.load(fh)


def note_404(page, label):
    page.on("response", lambda r: r.status == 404 and not r.url.startswith(BASE) and outside_404.append((label, r.url)))
BOOT_SECS = 90  # a download from the author's site, then the boot

# Where a part of the board sits, to see that facing north turns it in place rather than moving it.
BOX = """(sel) => { const r = document.querySelector(sel).getBoundingClientRect();
  return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }"""
# The panel canvas has something drawn on it (not one flat colour).
DRAWN = """() => { const c = document.querySelector('.fs-panel'); if (!c || !c.width) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 997) seen.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]);
  return seen.size > 8; }"""


def status(board):
    return board.locator(".fs-status").inner_text()


def playing(board):
    """The firmware the board names ("FM-1 · Felucca" -> "Felucca")."""
    return board.locator(".fs-name").inner_text().split(" · ", 1)[-1]


def wait_running(board, deck, name=None):
    """The board says `name` (or any firmware) runs, and so does the phone, and names it; a download or boot error
    fails at once with its words."""
    def check_state():
        s = status(board)
        if "running" in s:
            return s
        if board.locator(".fs-dot[data-state=error]").count():
            raise AssertionError(f"the board reports an error: {s}")
        return None
    try:
        wait(lambda: (name is None or name in board.locator(".fs-name").inner_text()) and check_state(), BOOT_SECS,
             f"{name or 'a firmware'} to run on the board")
        name = name or playing(board)
    except AssertionError as e:
        raise AssertionError(f"{e}; the board shows {board.locator('.fs-name').inner_text()!r}: {status(board)!r}") from None
    wait(lambda: name in deck.locator(".fd-name").inner_text() and "running" in deck.locator(".fd-text").inner_text(), 10,
         f"the phone to show {name} running")
    return name


def touch(board, fx, fy, pid, kind):
    """A touch on the panel at a share of its width and height (kind: pointerdown / pointerup)."""
    board.evaluate("""([fx, fy, pid, kind]) => { const c = document.querySelector('.fs-panel'), r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent(kind, { bubbles: true, cancelable: true, pointerId: pid, pointerType: 'touch',
        isPrimary: true, clientX: r.left + fx * r.width, clientY: r.top + fy * r.height })); }""", [fx, fy, pid, kind])


def main():
    proc = start_table(PORT, TABLE_KEY=KEY, GAMES_DIR=os.path.join(ROOT, "games"), PUBLIC_URL=BASE)
    try:
        with sync_playwright() as p:
            # The table's kiosk plays sound without a tap first; so does this browser.
            browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
            board = browser.new_context(viewport={"width": 1920, "height": 1080}, has_touch=True).new_page()
            watch(board, "board")
            note_404(board, "board")
            board.goto(BASE + "/board/")
            board.wait_for_selector("button.tile")
            deck = phone(browser, "Klaus", 320, 568)
            note_404(deck, "Klaus")
            pick_game(board, "fm1-synth")
            board.locator(".dialog [data-x=yes]").click()  # Device to start with: FM-1, the default
            time.sleep(0.4)
            deck.click("#ready")
            time.sleep(0.4)
            a("POST", "/game/start")
            st = a("GET", "/state")
            seat = next(x for x in st["players"] if x["name"] == "Klaus")["seat"]
            assert st["seatEdges"][seat] == "south", f"the player sits {st['seatEdges'][seat]}, not south"

            # The FM-1 on its first firmware, on the board and on the phone.
            board.wait_for_selector(".fs-panel")
            if deck.locator("#tab-game").count():
                deck.locator("#tab-game").click()
            # (the FM-1's first firmware, or the next when its package is gone)
            fm1_first = wait_running(board, deck)
            wait(lambda: board.evaluate(DRAWN), 10, "the panel to be drawn")
            assert board.locator(".fs-tap").is_hidden(), "the board asks for a tap although its sound may play"
            shot(board, "board-fm1")
            check(deck, "phone while playing")
            shot(deck, "phone")

            # A touch on a white key: the panel shows it held, and lets go.
            before = board.evaluate("() => document.querySelector('.fs-panel').toDataURL()")
            touch(board, 0.30, 0.91, 11, "pointerdown")
            time.sleep(0.3)
            held = board.evaluate("() => document.querySelector('.fs-panel').toDataURL()")
            touch(board, 0.30, 0.91, 11, "pointerup")
            assert held != before, "a touch on a key changed nothing on the panel"

            # Favorites: a star in the window keeps the order while it is open, puts the firmware first the next time,
            # and the phone keeps it in its browser (E-013).
            board.click(".fs-pick")
            board.wait_for_selector(".fs-picker:not([hidden]) .fs-card")
            wait(lambda: deck.evaluate("() => localStorage.getItem('fm1-synth.favorites')") is not None, 10,
                 "the phone to keep its (empty) stars")
            fav = board.locator(".fs-card").nth(2).get_attribute("data-id")
            board.tap(f".fs-card[data-id='{fav}'] .fs-star")
            wait(lambda: board.locator(f".fs-card[data-id='{fav}'] .fs-star.starred").count(), 10, "the star on the board")
            assert board.locator(".fs-card").nth(2).get_attribute("data-id") == fav, "the starred card moved while open"
            assert playing(board) == fm1_first, "a star changed the firmware"
            board.click(".fs-close")
            board.click(".fs-pick")
            wait(lambda: board.locator(".fs-card").first.get_attribute("data-id") == fav, 10, f"{fav} first in the window")
            wait(lambda: fav in (deck.evaluate("() => localStorage.getItem('fm1-synth.favorites')") or ""), 10,
                 "the phone to keep the star")
            assert deck.locator(f".fd-star.starred[data-id='{fav}']").count(), "the phone shows no star"
            shot(board, "picker-favorite")
            board.click(".fs-close")

            # The firmware window: its SMK-37 tab switches the board to the SMK-37 at once, on its first firmware, as
            # the phone's buttons do (E-006, E-011). Tapped, as on the table's touch screen.
            board.click(".fs-pick")
            board.wait_for_selector(".fs-picker:not([hidden]) .fs-card")
            assert board.locator(".fs-tab").all_inner_texts() == ["FM-1", "SMK-37"]
            assert "FM-1" in board.inner_text(".fs-sheet-title")
            # The SMK-37's first firmware cannot be downloaded right now (its site refuses the download, but still
            # answers that the package is there): the board passes over it. Another one's package is gone: it is
            # left out of the lists.
            smk = catalog("smk37")
            first = next(f for f in smk["firmwares"] if f["id"] == smk["default"])
            hidden = smk["firmwares"][-1]
            assert hidden["id"] != first["id"]
            def refused(route):
                if route.request.method == "GET":
                    return route.fulfill(status=404, body="gone")
                route.continue_()
            def gone(route):
                route.fulfill(status=404, body="gone")
            # (its install page too: upstream's fallback would look there for a package, and take another firmware's, #11)
            blocked = [first["package"]] + ([first["installer"]] if first.get("installer") else [])
            for url in blocked:
                board.context.route(url, refused)
            for page in (board, deck):
                for url in [hidden["package"]] + ([hidden["installer"]] if hidden.get("installer") else []):
                    page.context.route(url, gone)
            board.tap(".fs-tab[data-device=smk37]")
            wait(lambda: "SMK-37" in board.inner_text(".fs-sheet-title"), 10, "the SMK-37 list")
            nxt = wait_running(board, deck)
            assert nxt != first["name"] and f"{first['name']} can't be downloaded" in status(board), status(board)
            wait(lambda: board.locator(f".fs-card.gone[data-id='{first['id']}']").count(), 10, f"{first['name']} marked as not available")
            board.click(".fs-close")
            board.click(".fs-pick")
            for page, card in ((board, ".fs-card"), (deck, ".fd-fw")):
                wait(lambda: page.locator(card).count() and not page.locator(f"{card}[data-id='{hidden['id']}']").count(), 15,
                     f"{hidden['name']} left out on {page.label if hasattr(page, 'label') else 'the board'}")
            shot(board, "picker-unavailable")
            # back on its site: a tap on it tries again
            for url in blocked:
                board.context.unroute(url)
            board.tap(f".fs-card[data-id='{first['id']}']")
            wait_running(board, deck, first["name"])
            board.click(".fs-pick")
            wait(lambda: board.locator(f".fs-card.on[data-id='{first['id']}']:not(.gone)").count(), 10, f"{first['name']} marked in the window")
            assert board.locator(".fs-tab[data-device=smk37]").get_attribute("aria-selected") == "true"
            shot(board, "picker-smk37")
            board.click(".fs-close")
            assert "SMK-37" in board.inner_text(".fs-name")
            wait(lambda: board.evaluate("() => document.querySelector('.fs-panel').width") == 1920, 10, "the SMK-37 panel")
            shot(board, "board-smk37")

            # The phone switches back to the FM-1, on its first firmware again.
            deck.click(".fd-dev-btn[data-device=fm1]")
            wait_running(board, deck, fm1_first)

            # Facing north: the bar, the panel and the seat plate turn in place; nothing moves (E-007, E-008).
            places = {s: board.evaluate(BOX, s) for s in (".fs-bar", ".fs-frame", ".kit-plate")}
            a("POST", "/rotate", {"degrees": 180})
            wait(lambda: board.locator(".fs-north").count(), 10, "the board to face north")
            time.sleep(0.4)
            for s, box in places.items():
                now = board.evaluate(BOX, s)
                assert now == box, f"{s} moved when facing north: {box} -> {now}"
            turned = board.evaluate("() => getComputedStyle(document.querySelector('.kit-plate')).transform")
            assert turned.startswith("matrix(-1"), f"the seat plate did not turn: {turned}"
            shot(board, "board-north")
            a("POST", "/rotate", {"degrees": 180})

            # Finish on the phone: the game ends with a summary of what was played.
            deck.click(".fd-finish")
            deck.wait_for_selector(".fd-confirm:not([hidden])")
            check(deck, "phone asking to finish")
            shot(deck, "phone-finish")
            deck.click(".fd-keep")
            assert deck.locator(".fd-finish").is_visible() and a("GET", "/state")["phase"] == "active", "Keep playing did not go back"
            deck.click(".fd-finish")
            deck.click(".fd-end")
            wait(lambda: a("GET", "/state")["phase"] == "finished", 15, "the game to finish")
            summary = a("GET", "/state")["summary"]["text"]
            for part in ("Klaus played", fm1_first, "on the FM-1", nxt, first["name"], "on the SMK-37"):
                assert part in summary, f"{part!r} missing in the summary: {summary}"
            time.sleep(0.6)
            shot(board, "board-final")
            browser.close()
    finally:
        proc.terminate()
    if outside_404:
        print("404 from the firmwares' sites (handled by the game):\n  " + "\n  ".join(f"{l}: {u}" for l, u in outside_404))
    for label, _ in outside_404:
        i = next((i for i, e in enumerate(errors) if e.startswith(f"{label}:") and "status of 404" in e), None)
        if i is not None:
            del errors[i]
    if errors or problems:
        print("BROWSER ERRORS:\n" + "\n".join(errors) if errors else "", "\nLAYOUT PROBLEMS:\n" + "\n".join(problems) if problems else "")
        sys.exit(1)
    print(f"ok: FM-1 Synth from the lobby to the end ({summary}); screenshots in {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if errors:
            print("BROWSER ERRORS:\n" + "\n".join(errors[:10]))
        # On GitHub, an annotation carries the reason to the PR page, where the job log may not be at hand.
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::error file=scripts/e2e/fm1_synth.py::{type(e).__name__}: {str(e)[:900]}".replace("\n", " "))
        raise
