# Smart Students Attendance System

A front-end project made with HTML, CSS, and JavaScript for a college exhibition. Includes a college-logo login page, two role-based accounts, student profiles/photos, unique student QR IDs, live camera scanning, attendance records, leave management, duplicate-prevention, CSV exports, and JSON backup/restore.

## Run on your laptop

1. Extract `Smart-Students-Attendance-System-Role-Based.zip` to a folder.
2. Ensure your computer has Python 3 installed (the browser-based app itself does not use Python).
3. Open Command Prompt/Terminal inside the extracted folder.
4. Run one of these commands:
   - Windows: `py -m http.server 8000`
   - macOS/Linux: `python3 -m http.server 8000`
5. Open **http://localhost:8000** in Chrome or Edge. The login page appears first; successful login is required to access the app.
6. QR generation is bundled locally and works without internet. Internet access is needed only for the optional html5-qrcode camera scanner library; when it cannot load, supported browsers (such as recent Chrome/Edge) can use the built-in camera scanning fallback.
7. Go to **Students → Add student**, register a student and optionally upload their picture.
8. Go to **QR generator**, select that student, generate the QR and download/print it.
9. Go to **Scan attendance → Start camera** and allow camera permission. Scan the generated QR to mark the student present.
10. Find check-ins in **Attendance records**. Use **Backup JSON** regularly to save a portable backup.

## Login accounts and permissions

**Administrator**
- Username: `ADMIN`
- Password: `SSC-TEACHER`
- Full access, including add/edit/delete student profiles, cancel leave, clear selected-day records, restore backups, and all app pages.

**Student staff (add/view only)**
- Username: `CS-STUDENTS`
- Password: `1122`
- Can view records and profiles, add new student profiles, scan/add attendance, submit leave when no record already exists for that student/date, and generate/download QR codes. Cannot edit or delete student profiles, cancel leave, clear attendance records, or restore backups.

Logging out returns to the login page. Refreshing the page also requires signing in again. Existing records remain in the same browser database (`SmartAttendDB`) as long as you use the same browser profile and origin (for example, `http://localhost:8000`).

**Security limitation:** This is a local exhibition prototype. The credentials and role checks are implemented in front-end JavaScript, so this is not secure authentication against a technically capable user who can inspect or change the code in their browser. For a real college deployment, move login and permissions to a server/backend, store password hashes, and enforce every permission server-side. Do not put real sensitive student data into a publicly hosted version of this prototype.

## Open on a mobile phone

Camera scanning requires a secure browser context, usually HTTPS or localhost. `localhost` on a laptop is not the same as `localhost` on a phone. To use the phone camera, host the folder on an HTTPS web host (or configure a secure local development environment), then open that HTTPS address on the phone and allow camera permission.

## Data storage — important

This version uses **IndexedDB**, a browser database. Student data, resized photos and attendance records persist in the same browser profile on the same device, even after closing the tab. It is not a server database and it does not automatically sync between your laptop and phone. Use **Attendance records → Backup JSON** to download a backup, and **Restore backup** to import it on another browser. Keep backups secure because they contain student details and photos.

For multiple people/devices to write to a single shared attendance database, the project needs a backend/cloud database (for example, a server with SQL or a configured Firebase/Supabase project). Browser-only HTML/CSS/JavaScript cannot securely provide shared central storage on its own.

## Notes

- A roll number must be exactly 4 digits and unique. Leading zeroes are allowed (for example, 0042).
- Department is selected from Computer Science, Pre-Engineering, or Pre-Medical. Class is selected from First-Year A/B/C or Second-Year A/B/C. Father name is an optional profile field.
- Leave management lets you record a student as On Leave for a selected date and provide a reason. A student can have only one status per date. If a student is already Present, the leave form asks for confirmation before replacing Present with On Leave.
- QR codes contain only the student’s unique ID, not their personal details.
- Each student can have only one status record per day. Re-scanning a present student shows “Already marked PRESENT”; a student on leave cannot also be marked present for the same date.
- The Leave management page records a leave date and reason and shows saved leave entries. Only the administrator account can cancel a leave entry.
- Deleting a student keeps their historical attendance records.
- If camera access fails, check that you are on `http://localhost:8000` or HTTPS, that the browser has camera permission, and that another app is not using the camera.
- Data is local to this browser. Clearing site data/browser storage can remove it; export backups regularly.

## Files

- `index.html` — app structure
- `assets/college-logo.jpg` — supplied college logo used in the sidebar
- `assets/favicon.png` — logo used as the browser tab icon
- `styles.css` — responsive user interface
- `app.js` — login, role checks, IndexedDB, student management, QR generation/scanning, attendance records, imports/exports


## Password visibility toggle
The login password field includes an eye button. Click it to reveal the typed password; click again to hide it. Incorrect login attempts and logout reset the field to hidden. This change does not modify the existing ADMIN and CS-STUDENTS roles or the local database schema.


## New features in this update (Password-Eye base)

- Leave management now includes a search box for student name, roll number, or department. Search results populate the student selector.
- Student Date of Birth is now required on add/edit and cannot be a future date. Existing older student records without DOB remain in the browser database, but show “—” in reports until an administrator edits and fills their DOB.
- Attendance Records includes a date-range report with All Students or an individual student, quick This Month and This Year buttons, and custom From/To dates.
- Date-range and daily reports include student name, DOB, roll number, class, date, time, status, and punctuality. Reports can be exported as Excel-compatible CSV and downloaded directly as PDF files (no print dialog).
- The sidebar has a separate Daily Attendance Report workspace directly below QR Generator. It supports student search, individual/all-student selection, date selection, and PDF/CSV export.
- Attendance is blocked before 08:30 AM Pakistan Standard Time. Check-ins from 08:30:00 through 09:15:00 are On Time; check-ins after 09:15:00 are Late.

### Reporting notes

- A student/date with no saved attendance or leave record is shown as Absent. Dates before the student's registration date are shown as Not Registered. The report currently treats every calendar day in the selected date range as an instructional day; weekends and holidays are not automatically excluded.
- “Export Excel CSV” creates a UTF-8 CSV file that opens in Microsoft Excel. “Save PDF” builds and downloads a PDF file directly to the browser Downloads folder; it does not open the print dialog.
- The IndexedDB database name remains `SmartAttendDB` so existing records in the same browser profile and same origin are retained. The database is local to each browser/device, not a central server.


## Latest adjustments

- Leave Management uses a single searchable **Select student** field. Type a student name, roll number, or class and choose a result; the separate search box has been removed.
- Date-range and daily report **Save PDF** buttons now directly download a generated landscape PDF file. They no longer open a print window or print dialog.


## Latest attendance-rule and student-profile updates

- Attendance scan is blocked before **08:30 AM Pakistan time**. From 08:30:00 through 09:15:00 it is labelled **On Time**; after 09:15:00 it is labelled **Late**.
- A short two-tone beep plays when a QR is decoded (after Start camera is pressed and the browser allows audio).
- Student users cannot submit leave for a past date. Admin can submit past-dated leave.
- Daily report, date-range report, and Attendance Records now use searchable student pickers: type a name, roll number, department, or class and click the result.
- Student form now has Department, one of six First-Year/Second-Year classes, optional Father name, and the full-name example is Zain.
- Student storage keeps legacy `className` mapped to Department for old records and also stores the new `department`, `yearClass`, and `fatherName` fields.
- PDF reports include generation date/time (Pakistan time) and no longer show the old punctuality explanatory sentence.

After replacing files, keep the `assets` and `vendor` folders and use the same browser origin so the existing `SmartAttendDB` database remains available.


## Updated 31 October 2026 feature list

- QR attendance now plays a short two-tone beep immediately after a QR code is decoded. The browser audio context is prepared when the user presses Start camera; browser/device audio settings can still mute it.
- QR attendance cannot be recorded before 08:30 AM Pakistan time. From 08:30:00 to 09:15:00 the saved punctuality is On Time; after 09:15:00 it is Late. The check is applied before saving attendance.
- Daily Attendance Report, date-range report, and Attendance Records have a searchable student selector. Search by name, roll number, department, class, or father name, then choose the matching student (or choose All students). Records can also be filtered by typing without selecting.
- Only the administrator can enter a leave record for a past date. The CS-STUDENTS account has the date field min set to today and the submit handler rejects earlier dates.
- Student profile fields are Full name (example: Zain), 4-digit Roll number, mandatory Date of Birth, Department (Computer Science / Pre-Engineering / Pre-Medical), mandatory Class (First-Year A/B/C or Second-Year A/B/C), optional Father name, email, phone, and photo.
- Existing student records remain compatible: the legacy `className` property is still read as Department, while new profiles store `department`, `yearClass`, and `fatherName` separately. The database name/version is unchanged, so no IndexedDB reset is needed.
- PDF attendance reports show the date and time of generation in Pakistan time. The old explanatory punctuality sentence has been removed.


## Login/database startup fix

- Added the missing `departmentOf`, `yearClassOf`, `fatherNameOf`, `studentSearchText`, and `academicLabel` helper functions used while loading student cards, attendance records, leave pickers, and QR details.
- This resolves the `departmentOf is not defined` exception that was being shown in the login error banner after valid credentials. It does not delete or recreate the `SmartAttendDB` database.
