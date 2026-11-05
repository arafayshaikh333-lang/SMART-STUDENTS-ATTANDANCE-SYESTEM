# Supabase-connected Smart Students Attendance System

## What is configured

- Supabase project URL and the project's **publishable** key are configured in `app.js`.
- The browser uses the official Supabase JS v2 UMD CDN build.
- Website username `ADMIN` maps internally to `admin@attendance.example.com`.
- Website username `CS-STUDENTS` maps internally to `cs-students@attendance.example.com`.
- The password for each portal is the password set for that matching Supabase Auth user in the Supabase dashboard. The old hard-coded browser-only passwords are no longer used.
- The Auth users must have matching rows in `public.profiles` (`admin` and `student`).
- Browser IndexedDB remains the local/offline copy. On successful online sign-in, records are merged with Supabase and uploaded/downloaded. Sync is attempted after writes, when the connection returns, and periodically while the app is open.

## Required Supabase setup already completed in the dashboard

1. The tables `students`, `attendance`, `leave_requests`, and `profiles` were created in the SQL Editor.
2. Email provider is enabled and email confirmation was switched off.
3. Two Auth users were created using the internal IDs above.
4. The two Auth user UUIDs were inserted into `public.profiles` with roles `admin` and `student`.
5. Row Level Security policies were created by the initial database SQL.

Do not add a Supabase `sb_secret_...` key to the website. The publishable key is intended for browser use; RLS policies are the database security boundary.

## Deploying the updated website

1. Extract this ZIP.
2. Upload/commit the contents of the project folder to the same GitHub repository currently used by the website. Keep `index.html` at the published root (or preserve your repository's current Pages folder arrangement).
3. Commit and push the changes. GitHub Pages will publish the new version using the existing Pages configuration.
4. Open the HTTPS GitHub Pages address while online, then sign in once on each device using the relevant website username and the password configured for that Supabase Auth user.
5. Keep the same website origin on every device. Do not switch between a GitHub Pages URL, a custom domain, and `file://` when expecting the same local cache.

## Offline behavior and limitations

- The PWA service worker caches the app shell and the Supabase browser library after its first successful online load.
- Each device has its own IndexedDB cache. While offline, changes are written locally.
- When online again, a device with an active Supabase session syncs pending local data. If the user signed out and later used the locally cached offline login, sign out and sign in online again to authenticate and sync pending changes.
- A first-time device sign-in requires internet. Offline data from another device cannot appear until it has synced to Supabase.
- The `CS-STUDENTS` account is intentionally shared. Supabase therefore sees all student-portal actions as the same shared user; the system cannot prove which individual student submitted a request. A student who knows the shared password can access the student portal.
- Conflicting edits are merged using record timestamps; avoid editing the same student on multiple offline devices at the same time.
- Keep using the Admin JSON backup feature. A cloud database is not a substitute for independent backups.

## Installing on mobile

- Android: open the HTTPS website in Chrome and choose **Install app** or **Add to Home screen** from the browser menu.
- iPhone: open the HTTPS website in Safari, tap Share, then **Add to Home Screen**.

The camera and service worker require a secure HTTPS origin (GitHub Pages provides HTTPS).
