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
- Can view records and profiles, add new student profiles, scan/add attendance, submit leave requests, and generate/download QR codes. Student leave requests remain Waiting for Approval until the administrator acts. Cannot edit or delete student profiles, cancel leave, approve/reject requests, clear attendance records, or restore backups.

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
- Student-submitted leave requests remain Waiting for Approval until an administrator approves them. Admin-entered leave records are added immediately. A student can have only one attendance status per date; when approving a request over an existing status, the admin must confirm the replacement.
- QR codes contain only the student’s unique ID, not their personal details.
- Each student can have only one status record per day. Re-scanning a present student shows “Already marked PRESENT”; a student on leave cannot also be marked present for the same date.
- Leave management shows pending/rejected requests and approved leave entries. Only the administrator account can cancel an approved leave entry.
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
- Student form has Department, one of six First-Year/Second-Year classes, optional Father name, and the full-name placeholder example is “e.g. ABDUL RAFAY.”
- Student storage keeps legacy `className` mapped to Department for old records and also stores the new `department`, `yearClass`, and `fatherName` fields.
- PDF reports include generation date/time (Pakistan time) and no longer show the old punctuality explanatory sentence.

After replacing files, keep the `assets` and `vendor` folders and use the same browser origin so the existing `SmartAttendDB` database remains available.


## Updated 31 October 2026 feature list

- QR attendance now plays a short two-tone beep immediately after a QR code is decoded. The browser audio context is prepared when the user presses Start camera; browser/device audio settings can still mute it.
- QR attendance cannot be recorded before 08:30 AM Pakistan time. From 08:30:00 to 09:15:00 the saved punctuality is On Time; after 09:15:00 it is Late. The check is applied before saving attendance.
- Daily Attendance Report, date-range report, and Attendance Records have a searchable student selector. Search by name, roll number, department, class, or father name, then choose the matching student (or choose All students). Records can also be filtered by typing without selecting.
- Only the administrator can enter a leave record for a past date. The CS-STUDENTS account has the date field min set to today and the submit handler rejects earlier dates.
- Student profile fields are Full name (placeholder example: e.g. ABDUL RAFAY), 4-digit Roll number, mandatory Date of Birth, Department (Computer Science / Pre-Engineering / Pre-Medical), mandatory Class (First-Year A/B/C or Second-Year A/B/C), optional Father name, email, phone, and photo.
- Existing student records remain compatible: the legacy `className` property is still read as Department, while new profiles store `department`, `yearClass`, and `fatherName` separately. The database name remains `SmartAttendDB`; its version upgrades automatically to add the leave-request store without clearing existing records.
- PDF attendance reports show the date and time of generation in Pakistan time. The old explanatory punctuality sentence has been removed.


## Login/database startup fix

- Added the missing `departmentOf`, `yearClassOf`, `fatherNameOf`, `studentSearchText`, and `academicLabel` helper functions used while loading student cards, attendance records, leave pickers, and QR details.
- This resolves the `departmentOf is not defined` exception that was being shown in the login error banner after valid credentials. It does not delete or recreate the `SmartAttendDB` database.


## 1 November 2026 updates — QR search and 10:00 AM cutoff

- QR Generator now has a searchable **Search and select student** field. Search by student name, roll number, department, class, or father name, then select the matching result before generating the QR. The hidden select remains as the underlying selected student ID for compatibility with existing QR generation code.
- Attendance remains unavailable before 08:30 AM Pakistan time. From 08:30:00 AM through 09:15:00 AM it is On Time; after 09:15:00 AM and through exactly 10:00:00 AM it is Late.
- After 10:00:00 AM Pakistan time, a new QR attendance attempt does not create a Present record. If the student has no existing record for today, the system saves an **Absent** record with the attempt time and cutoff reason. If the student was already Present or On Leave, the existing status is retained.
- Leave submission for **today** is blocked for all roles after 10:00 AM Pakistan time. Admin past-date leave permission remains unchanged; future-dated leave is not affected by today's cutoff.
- Attendance reports show the time of a post-cutoff Absent scan attempt when that record exists. Students with no record are still calculated as Absent in date-based reports.
- Dashboard Absent count now includes students with an explicit Absent record, as well as students without a Present or Leave record.

The 10:00 AM check is based on the Asia/Karachi time zone and uses a strict after-10:00:00 comparison; exactly 10:00:00 AM is still within the Late check-in window.


## Admin-only Reset & Restore Backup (1 November 2026)

The Attendance records page now has a separate **Reset & Restore Backup** action visible only to the ADMIN role. It is different from the existing **Merge backup** action:

- **Backup JSON** on the shared college browser exports all student profiles (including photos) and attendance/leave history into one JSON file.
- Transfer that JSON file privately to the teacher (for example, through a secure file-transfer method).
- Open the same website on the teacher's phone, sign in as ADMIN, go to Attendance records, and choose **Reset & Restore Backup**.
- The app validates the selected backup, confirms the replacement, automatically downloads a safety copy of the phone's current local database, then atomically clears and replaces the phone's student and attendance stores with the selected backup.
- The existing **Merge backup** action remains available for adding records without replacing the current database.

**Important:** Reset & Restore replaces all current records on the device where it is run. Select the complete JSON backup from the college browser, not an Excel/CSV file. Do not clear browser site data. IndexedDB is local to each device/browser; this process is a manual transfer, not automatic cloud synchronization. Use only trusted private transfer because the JSON can contain student details and photos. The reset action is hidden from CS-STUDENTS and also checks the Admin role in its handler.


## Leave request approval (latest update)

- CS-STUDENTS leave submissions are saved separately as **Pending** requests and displayed as **Waiting for Approval** in Leave management. They do not affect daily attendance until a teacher approves them.
- The **Leave Approvals** page appears only in the `ADMIN` / `SSC-TEACHER` portal, directly below Daily Attendance Report in the sidebar. The teacher can approve or reject pending requests and review their final status.
- Approving a request creates or updates the student's attendance record to **On Leave**. A conflicting attendance status requires administrator confirmation before it is replaced.
- The IndexedDB version upgrades automatically while keeping the existing `SmartAttendDB` database and current student/attendance records. JSON backup, merge restore, and reset/restore now include leave requests too.
