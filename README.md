# Aflah Daycare website

A static website for **Aflah Daycare**: *Happiness & Inclusion*. It uses the **Bright & Playful** design, which follows the layout of the reference site littlemiracleslearning.ca and takes its colours from the Aflah logo.

It is plain HTML, CSS and a little JavaScript. There is no build step and no framework, so any static host can serve it, including GitHub Pages.

## Pages

| File | What's on it |
| --- | --- |
| `index.html` | Home: photo hero with Enroll Now, three highlight cards, about with a counting badge, our value, program cards, Join Us banner, value circles, teachers, why choose us |
| `about.html` | Our story and the meaning of "Aflah", the tree-of-life logo story, mission and vision, six core values (Raḥmah, Saʿādah, Shumūliyyah, Adab, Iḥsān, Amānah), our teachers |
| `programs.html` | Seedlings (infants), Sprouts (toddlers), Saplings (preschool) and Branches (school age), everyday enrichment, full daily schedule |
| `admissions.html` | Registration: four enrollment steps, tuition and fees, what to bring, FAQ, waitlist form |
| `contact.html` | Address, phone, email and hours, contact form, what to expect on a tour |
| `admin/` | Admin portal for the director (see [Admin and staff portals](#admin-and-staff-portals)) |
| `staff/` | Staff portal for educators |

```
assets/
  css/styles.css     all styles (colours are CSS variables at the top)
  js/main.js         mobile menu, scroll effects, form handling
  images/            hero image, logo, emblem, placeholder photo crops, favicon, touch icon
app/                 the admin and staff portals (shared code, styles and settings)
supabase/schema.sql  database tables and security rules for the portals
```

## Preview locally

Open `index.html` in a browser, or run a small local server:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Before going live: replace the placeholders

These values are **placeholders** and appear on every page, in the footer and on the contact page. Search and replace them across all `.html` files:

| Placeholder | Replace with |
| --- | --- |
| `(555) 123-4567` and `+15551234567` | Your phone number (display format and `tel:` format) |
| `hello@aflahdaycare.ca` | Your email address (also in each form's `data-mailto`) |
| `123 Maple Street` / `Your City, Province A1B 2C3` | Your address. The "Get directions" links contain the same address URL-encoded, so update those too. |
| `7:00 AM – 6:00 PM`, `Mon–Fri` | Your real opening hours |

Also review the copy so it matches how you actually operate: age ranges, program names, meals, staff qualifications, the FAQ answers and the sample schedule.

## Making the forms deliver messages

By default, the contact and waitlist forms open the visitor's email app with the message filled in. To receive submissions directly instead:

1. Create a free form at a service such as [Formspree](https://formspree.io).
2. Add its URL as the form's `action`, for example:
   ```html
   <form class="form" method="post" action="https://formspree.io/f/your-id" data-form ...>
   ```
   Do this for the form in both `contact.html` and `admissions.html`.

When `action` is set, `main.js` sends the form in the background and shows a thank-you message on the page.

## Publishing on Vercel

The site needs no build step, so Vercel can serve the repository as it is.

1. Sign in at [vercel.com](https://vercel.com) with your GitHub account.
2. Choose **Add New… → Project**, find **Aflah-daycare** under *Import Git Repository* and click **Import**. If the repository isn't listed, use **Adjust GitHub App Permissions** to give Vercel access to it.
3. Leave the settings as detected: Framework Preset **Other**, Root Directory `./`, and no build command or output directory.
4. Click **Deploy**. The site goes live at an address like `https://aflah-daycare.vercel.app`.

After that, every push to the repository's default branch redeploys the live site automatically, and other branches get their own preview links. To use your own domain, open the project's **Settings → Domains**.

## Admin and staff portals

Two private portals sit alongside the website. Both work on phones, tablets and computers. The footer of every page has a small **Staff login** link.

**Admin portal: `/admin/`** (for the director)

- **Dashboard:** children here now, staff on shift, and a *Needs your attention* list with new staff sign-ups to approve, open incident reports and overdue balances.
- **Children:** enrolled, waitlist and withdrawn children, with room, program, date of birth, monthly fee, parent contacts, allergies and medical notes.
- **Children's sign in** and **Timesheets:** the same screens staff use, plus *Print all* for every child's timesheet.
- **Staff:** approve or decline new sign-ups, change roles and deactivate people who leave.
- **Staff hours:** each educator's weekly hours, and corrections to shift times.
- **Payments:** each family's charges, payments and outstanding balance. Record payments (e-transfer, cash, cheque, card or subsidy), add one-off charges, bill a month's tuition to every enrolled child in one step (children already billed for that month are skipped) and open a printable statement for a family.
- **Incident reports:** read every report, add review notes and mark it reviewed.
- **Settings:** set the daycare's location, and choose whether staff can sign in and out only there (see [Sign in only at the daycare](#sign-in-only-at-the-daycare)).

**Staff portal: `/staff/`** (for educators)

- **My shift:** sign in at the start of a shift and sign out at the end. The times come from the server clock, not the device, and staff see their hours for the week.
- **Children's sign in:** today's list of children by room. Tap *Sign in* or *Sign out*, tap a time to correct it, or mark a child *Absent*. Each day has two sign in / sign out pairs, for before- and after-school care.
- **Timesheets:** each child's sheet laid out like the paper *Children Timesheet*: child's full name, room and date of birth, Monday to Friday for four weeks, *Absent* days, hours per day, total hours and a line for the parent's signature. Print it, or save it as a PDF.
- **Incident reports:** write a report (child, when, where, what happened, first aid or action taken, witnesses, whether and when a parent was told). Staff see their own reports; once the director reviews one it becomes read-only.

### Sign in only at the daycare

Staff can sign in and out of their shifts, and sign children in and out, only while their phone or tablet is at the daycare:

- When a staff member taps *Sign in* or *Sign out*, the portal asks the device for its location. The first time, the browser asks them to allow location access for the site.
- The database checks that the location is within the distance you chose (150 m by default) of the daycare's location, allowing for GPS accuracy. If it's too far, nothing is saved and they see how far away they are, for example "You're about 3.2 km from the daycare".
- A successful check lasts 5 minutes, so signing in a line of children at drop-off doesn't wait for GPS each time.
- This covers everything staff change on the children's timesheet (sign in, sign out, time corrections and *Absent*) and their own shift sign in and sign out. Incident reports can be written anywhere.
- Directors (admins) can sign in, sign out and correct times from anywhere. If someone forgets to sign out before leaving, a director corrects it under *Staff hours*.
- The portal doesn't keep a record of where anyone was. It only checks the distance at the moment of signing in or out.

Set it up in the admin portal under **Settings**: stand inside the daycare and tap *Use my current location* (or paste the location from Google Maps), check the pin on the map, and save. Until the location is set, staff can't sign in or out, and the dashboard reminds you. If staff inside the building are told they're too far away, choose a larger distance. You can also turn the rule off there.

Phones and tablets work best. A desktop computer without Wi-Fi often can't tell where it is precisely enough to pass the check.

It relies on the location the phone reports, so it stops ordinary sign-ins from home or the car, but someone determined could fake their location with special apps. For a stricter check, the portals could also be limited to the daycare's Wi-Fi.

### Demo mode

Until the portals are connected to a database they run in **demo mode**: sample children, staff, payments and reports that are saved only in that browser. Use the *Explore* button on the sign-in screen to try each portal, and *Reset sample data* to start over. Nothing entered in demo mode is shared with anyone else, so don't use it for real records.

In the demo, the staff portal has a *Pretend you're* switch in the yellow banner, so you can see what happens at the daycare and away from it without going anywhere.

### Going live with Supabase

The portals store their data in [Supabase](https://supabase.com), a hosted Postgres database with logins. The free plan is enough to start.

1. **Create a project.** Sign up at supabase.com and create a new project. For a centre in Canada, pick the *Canada (Central)* region so records stay in Canada. Save the database password somewhere safe.
2. **Create the tables.** In the project, open **SQL Editor**, paste the whole of `supabase/schema.sql`, and click **Run**. This creates the tables and the security rules that decide who can see and change what.
3. **Connect the portals.** Click **Connect** at the top of the project (or open **Project Settings → API Keys**) and copy the **Project URL** and the **anon** key (newer projects call it the *publishable* key). Paste them into `app/config.js`:
   ```js
   supabaseUrl: "https://your-project.supabase.co",
   supabaseAnonKey: "your-anon-or-publishable-key",
   ```
   This key is meant to be public and is safe in the website code: the security rules in the database are what protect the records. Never put the **service_role** or **secret** key in the site.
4. **Set the login links.** In **Authentication → URL Configuration**, set *Site URL* to `https://aflah-daycare.vercel.app` and add these *Redirect URLs*:
   ```
   https://aflah-daycare.vercel.app/admin/
   https://aflah-daycare.vercel.app/staff/
   ```
   Use your own domain here instead if you add one. These make the confirmation and password reset emails bring people back to the right portal.
5. **Publish.** Commit and push `app/config.js`. Vercel redeploys and the portals switch from demo mode to the real database.
6. **Make yourself the admin.** Open `/admin/`, choose *Create an account*, and confirm your email. New accounts start as *waiting for approval*, so make the first admin yourself: in **SQL Editor**, run
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
   with your own email, then sign in again.
7. **Set the daycare's location.** At the daycare, open *Settings* in the admin portal, tap *Use my current location*, check the pin on the map and save. Staff can't sign in or out until this is done.
8. **Add your staff.** Each educator opens `/staff/` and creates an account. They appear on your dashboard under *Needs your attention*; approve them as **Staff** (or **Admin** for another director). Nobody can see any records until an admin approves them.
9. **Add your children** under *Children*, then set up tuition under *Payments*.

Supabase's built-in email sender only allows a few emails an hour. Before inviting all your staff, set up your own email sender under **Authentication → Emails → SMTP Settings** (for example with Resend, Postmark or your email provider).

### Who can do what

| | Admin | Staff | Waiting for approval |
| --- | --- | --- | --- |
| Children's names, rooms and health notes | View and edit | View | No access |
| Children's sign in / sign out and timesheets | View and edit from anywhere | View; edit at the daycare | No access |
| Own shift sign in / sign out | Yes, from anywhere | Yes, at the daycare | No access |
| Everyone's shift hours | View and edit | Own only | No access |
| Incident reports | All; review them | Write; see own | No access |
| Payments, charges and balances | View and edit | No access | No access |
| Approve staff, change roles | Yes | No | No |
| Daycare location and the sign-in rule | Yes | No | No |

These rules are enforced by the database itself (Postgres row-level security in `supabase/schema.sql`), not only by the screens, so they hold even if someone edits the page code in their browser. Deactivating a person under *Staff* removes their access straight away.

### Privacy and records

The portals hold personal information about children and families. Keep admin accounts to the people who need them, ask staff to use strong passwords, and remove access when someone leaves. Check which records your province's child care licensing rules require you to keep and for how long (attendance, incident reports and so on), and keep printed or exported copies where needed. Supabase's paid plans include daily backups. On the free plan, keep your own copies: export the tables to CSV from the **Table Editor** from time to time, and print or save the timesheets and statements as PDFs.

## Editing tips

- **Colours** live at the top of `assets/css/styles.css` (`--yellow` for buttons, `--green` for headings, `--blue` and `--sky` for labels, `--red` for the active menu item and badges, and the `.c-blue`, `.c-green`, `.c-orange` and `.c-pink` colour sets for cards).
- **Fonts** load from Google Fonts: Fredoka (rounded) for headings, buttons and the menu, Nunito for paragraphs, and Patrick Hand for the small handwritten labels above headings. They are set as `--display`, `--font` and `--hand` at the top of `assets/css/styles.css`.
- The **header and footer** are repeated in each page. If you change a menu link or contact detail, update all five files.
- **Photos:** replace the placeholder crops in `assets/images/` with real photos of your classrooms (same file names). The big photo at the top of each page is `aflah-hero.jpg`.

## Photos and artwork

The photos on the site (`assets/images/shelf.jpg`, `letters.jpg`, `window.jpg`, `toys.jpg`, `books.jpg` and `lamps.jpg`) are crops of the logo artwork and are placeholders only. Replace them with real photos of the centre, keeping the same file names, and every page picks them up.

The logo and classroom artwork are used exactly as supplied, including their Arabic writing. The page text itself uses no Arabic script.
