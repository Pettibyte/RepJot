# Phase 19 — Manual test sheet

Phase 19 adds Settings. Some of its rules cannot be proved by this build's
automated tests, because the project has no DOM test harness. Run these checks
by hand before you call the phase done.

Run the app with `bun run dev`, or open the built bundle at `dist/index.html`
through a static server. Sign in with a test Google account that holds real
data you do not mind losing.

## 1. The typed delete phrase

This is the rule the automated suite cannot reach: a keystroke must enable a
button.

Open **Settings** → **Danger Zone** → **Delete All User Data**.

| Step | Type into the field | Delete button |
| --- | --- | --- |
| 1 | (nothing) | Disabled |
| 2 | `delete all user data` | Disabled — lowercase does not count |
| 3 | `Delete All User Data` | Disabled — title case does not count |
| 4 | `DELETE ALL USER` | Disabled — short |
| 5 | `DELETE ALL USER DATA ` (one trailing space) | Disabled — padding does not count |
| 6 | ` DELETE ALL USER DATA` (one leading space) | Disabled |
| 7 | `DELETE ALL USER DATA` | **Enabled** |

Then press **Cancel**. The field clears with the panel and the button is gone.

Also confirm:

- The panel shows a file count that matches what the Drive folder holds.
- The panel says another device can put the files back.
- The words "irreversible", "permanently", and "cannot be undone" appear
  nowhere on the screen.

## 2. Delete All User Data against a live account

1. Sign in on two devices. Record a workout on device A and leave it
   unsynced.
2. On device B, open **Settings** → **Danger Zone** → **Delete All User
   Data**, type the phrase, and confirm.
3. Open Google Drive and look inside the app-data folder. No
   `preferences.json` and no `results-YYYY-MM.json` file remains.
4. Confirm device B landed on the REP JOT landing page and asks you to sign
   in.
5. Confirm device B holds no local rows. Open the browser dev tools, then
   **Application** → **IndexedDB**. The database for that account has no
   `doc:`, `base:`, or `pending:` keys.
6. Confirm the Google grant is gone. Open
   [Google Account connections](https://myaccount.google.com/connections)
   and check that REP JOT is not listed.

## 3. The other-device warning is true

Finish step 1 above with device A still holding an unsynced workout, then
delete from device B, then sync device A.

Expected: device A writes its pending edit back up and the files reappear in
the Drive folder. This is the behaviour the dialog warns about. The delete is
not a remote wipe of every device, and the copy must not claim that it is.

## 4. Disconnect Google Account

1. Sign in on a device with data in Drive.
2. Open **Settings** → **Danger Zone** → **Disconnect Google Account**.
3. Confirm the first press only opens the second-step copy. Nothing happens
   until the second press.
4. Press **Disconnect Google Account** again.
5. Confirm the device lands on the landing page.
6. Confirm the local rows are gone, the same way as step 5 above.
7. Confirm the Drive folder still holds every file. Disconnect cuts the
   grant; it does not delete anything remote.
8. Confirm the grant is gone at
   [Google Account connections](https://myaccount.google.com/connections).
9. Sign in again. The history comes back from Drive.

## 5. A revoke Google will not confirm

Force this by blocking `oauth2.googleapis.com` in dev tools, then press
**Disconnect Google Account**.

Expected:

- The section shows "Google did not confirm that it revoked REP JOT access."
- The section shows an **Open Google Account connections** button that points
  at `https://myaccount.google.com/connections`.
- The local data stays. The page does not navigate away.
- You can press **Disconnect** again once the network returns.

## 6. Data Export

1. Open **Settings** → **Data Export** → **Refresh file list**.
2. Confirm one row per file in the Drive app-data folder, with its size and
   a flag that says whether REP JOT owns the name.
3. Put a file in the folder by hand through the Drive console. Refresh. The
   row appears and reads **Not a REP JOT file**.
4. Download `preferences.json`. Open the saved file and compare it with the
   Drive copy byte for byte. They match.
5. Download the hand-made file. It saves unchanged.
6. Create two files with the same name in the folder. Refresh. Both rows show
   a download name that carries the Drive file ID, so both save side by side
   instead of one overwriting the other.
7. Break one file — replace its content with something Drive will not serve —
   and press its **Download**. The row shows a failure line. Every other row
   still downloads.

## 7. Diagnostics

1. Open **Settings** → **Diagnostics**.
2. Confirm the event count reads `No events recorded yet in this session.`
   on a fresh page.
3. Do something that logs an event, such as saving a workout. Re-render the
   section and confirm the count moved.
4. Press **Download diagnostic log** and open the file.
5. Search the file for `ya29.`, `Bearer`, `authorization`, and `token`.
   None of them appear. The log holds no credential.
   REQUIREMENTS 12.12.
6. Confirm the app never sends the log anywhere. In the dev tools **Network**
   tab, watch for a request that carries the log body. There is none.

## 8. Exercise Units

1. Open **Settings** → **Exercise Units**.
2. Confirm one row per exercise in the bundle, sorted by name.
3. On an exercise with a switchable unit, tap the pill. The unit changes and
   the save badge in the header moves through **Saving…** to **Saved**.
4. Reload the page. The new unit is still showing.
5. Open **Data Export**, download `preferences.json`, and confirm the file
   carries the unit you just chose.
6. Go to an active workout and confirm the pill there shows the same unit.
   The two controls read and write one store.
7. On an exercise whose dimension has one unit, confirm the unit shows as
   plain text with no pill.

## 9. Anonymous Settings

1. Sign out.
2. Open `#/settings`.
3. Confirm the page shows the sign-in control and the license line, and
   shows no units list, no export list, no diagnostics, and no danger zone.
4. Sign in from that page. The full Settings screen renders.

## 10. Kindle Scribe

Open the built bundle on a Kindle Scribe and repeat steps 1, 4, 6, and 7.
The Scribe browser is the target device, and the download path is the part
most likely to differ there.

| Check | Expected |
| --- | --- |
| Typed phrase gate | Same enable rule as step 1 |
| Disconnect | Lands on the landing page, local rows cleared |
| Export download | The file reaches the browser download list |
| Diagnostic download | The JSON file reaches the browser download list |

## Sign-off

Write the date, the device, and the Google account you used. Note anything
that differed from this sheet, including anything that passed by luck.
