# Aflah Daycare website

A static website for **Aflah Daycare**: *Happiness & Inclusion*. It uses the **Bright & Playful** design, which follows the layout of the reference site littlemiracleslearning.ca and takes its colours from the Aflah logo.

It is plain HTML, CSS and a little JavaScript. There is no build step and no framework, so any static host can serve it, including GitHub Pages.

## Pages

| File | What's on it |
| --- | --- |
| `index.html` | Home: photo hero with Enroll Now, three highlight cards, about with a counting badge, our value, program cards, Join Us banner, value circles, teachers, why choose us |
| `about.html` | Our story and the meaning of "Aflah", the tree-of-life logo story, mission and vision, six core values (compassion, happiness, inclusion, respect, excellence and trust), our teachers |
| `programs.html` | Seedlings (infants), Sprouts (toddlers), Saplings (preschool) and Branches (school age), everyday enrichment, full daily schedule |
| `admissions.html` | Registration: four enrollment steps, tuition and fees, what to bring, FAQ, waitlist form |
| `contact.html` | Address, phone, email and hours, contact form, what to expect on a tour |

```
assets/
  css/styles.css     all styles (colours are CSS variables at the top)
  js/main.js         mobile menu, scroll effects, form handling
  images/            hero image, logo, emblem, placeholder photo crops, favicon, touch icon
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

## Editing tips

- **Colours** live at the top of `assets/css/styles.css` (`--yellow` for buttons, `--green` for headings, `--blue` and `--sky` for labels, `--red` for the active menu item and badges, and the `.c-blue`, `.c-green`, `.c-orange` and `.c-pink` colour sets for cards).
- **Fonts** load from Google Fonts: Poppins for all text.
- The **header and footer** are repeated in each page. If you change a menu link or contact detail, update all five files.
- **Photos:** replace the placeholder crops in `assets/images/` with real photos of your classrooms (same file names). The big photo at the top of each page is `aflah-hero.jpg`.

## Photos and artwork

The photos on the site (`assets/images/shelf.jpg`, `plant.jpg`, `window.jpg`, `toys.jpg`, `books.jpg` and `lamps.jpg`) are crops of the logo artwork and are placeholders only. Replace them with real photos of the centre, keeping the same file names, and every page picks them up.

The Arabic writing has been removed from the logo and the classroom artwork: the text around the top of the logo ring and the alphabet charts on the wall. The original versions are in the git history.
