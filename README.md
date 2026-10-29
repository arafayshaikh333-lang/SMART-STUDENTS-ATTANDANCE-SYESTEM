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
- Class/department is selected from Computer Science, Pre-Engineering, or Pre-Medical.
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
