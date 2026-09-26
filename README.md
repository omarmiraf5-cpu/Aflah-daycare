# Aflah Daycare website

A static website for **Aflah Daycare**: *سعادة وشمولية (Happiness & Inclusion)*. It uses the **Bright & Playful** design (Sample 1 in `samples/`), which follows the layout of the reference site littlemiracleslearning.ca and takes its colours from the Aflah logo.

It is plain HTML, CSS and a little JavaScript. There is no build step and no framework, so any static host can serve it, including GitHub Pages.

## Pages

| File | What's on it |
| --- | --- |
| `index.html` | Home: photo hero with Enroll Now, three highlight cards, about with a counting badge, our value, program cards, Join Us banner, value circles, teachers, why choose us |
| `about.html` | Our story and the meaning of "Aflah", the tree-of-life logo story, mission and vision, six core values (Raḥmah, Saʿādah, Shumūliyyah, Adab, Iḥsān, Amānah), our teachers |
| `programs.html` | Seedlings (infants), Sprouts (toddlers), Saplings (preschool) and Branches (school age), everyday enrichment, full daily schedule |
| `admissions.html` | Registration: four enrollment steps, tuition and fees, what to bring, FAQ, waitlist form |
| `contact.html` | Address, phone, email and hours, contact form, what to expect on a tour |

```
assets/
  css/styles.css     all styles (colours are CSS variables at the top)
  js/main.js         mobile menu, scroll effects, form handling
  images/            hero image, logo, emblem, placeholder photo crops, favicon, touch icon
```

## Homepage design samples

`samples/` holds the three homepage designs that were compared before choosing the final look. **Sample 1 was chosen** and is now used across the whole site; the samples are kept for reference.

| File | Style |
| --- | --- |
| `samples/index.html` | Gallery comparing all three samples |
| `samples/sample-1-bright.html` | **Bright & Playful**: closest to the reference, with white sections, rainbow lettering and yellow buttons |
| `samples/sample-2-heritage.html` | **Heritage Elegance**: navy and gold, Islamic star patterns, arch-shaped photos and Arabic section names |
| `samples/sample-3-pastel.html` | **Soft Pastel**: mint, peach and lavender, blob-shaped photos and illustrated icons |

The photos on the site and in the samples (`assets/images/shelf.jpg`, `letters.jpg`, `window.jpg`, `toys.jpg`, `books.jpg`, `lamps.jpg`) are crops of the logo artwork and are placeholders only. Replace them with real photos of the centre, keeping the same file names, and every page picks them up.

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

## Publishing on GitHub Pages

1. On GitHub, go to **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, select the branch, and set the folder to `/ (root)`.
3. Save. The site will appear at `https://<username>.github.io/<repo>/`. You can add a custom domain on the same screen.

## Editing tips

- **Colours** live at the top of `assets/css/styles.css` (`--yellow` for buttons, `--green` for headings, `--blue` and `--sky` for labels, `--red` for the active menu item and badges, and the `.c-blue`, `.c-green`, `.c-orange` and `.c-pink` colour sets for cards).
- **Fonts** load from Google Fonts: Poppins for all text and Amiri for Arabic.
- The **header and footer** are repeated in each page. If you change a menu link or contact detail, update all five files.
- **Photos:** replace the placeholder crops in `assets/images/` with real photos of your classrooms (same file names). The big photo at the top of each page is `aflah-hero.jpg`.
