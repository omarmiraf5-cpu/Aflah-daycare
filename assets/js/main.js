/* Aflah Daycare — menu, scroll animations, counters and forms. The site works without JavaScript. */
(() => {
  const header = document.querySelector(".header");
  const toggle = document.querySelector(".menu-btn");
  const nav = document.getElementById("nav");

  // Mobile menu
  if (toggle && nav) {
    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      nav.classList.toggle("is-open", open);
    };
    toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
    window.matchMedia("(min-width: 981px)").addEventListener("change", (event) => {
      if (event.matches) setOpen(false);
    });
  }

  // Header shadow once the page scrolls
  if (header) {
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Count a number up from zero when it scrolls into view
  const countUp = (el) => {
    const target = Number(el.dataset.count);
    if (reduceMotion || !target) return;
    const duration = 1400;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      el.textContent = String(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) requestAnimationFrame(tick);
    };
    el.textContent = "0";
    requestAnimationFrame(tick);
  };

  // Fade and slide sections in as they scroll into view
  const revealItems = document.querySelectorAll("[data-reveal]");
  const counters = document.querySelectorAll("[data-count]");
  if ("IntersectionObserver" in window && !reduceMotion) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          if (entry.target.hasAttribute("data-count")) countUp(entry.target);
          else entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    revealItems.forEach((el) => observer.observe(el));
    counters.forEach((el) => observer.observe(el));
  } else {
    revealItems.forEach((el) => el.classList.add("is-in"));
  }

  // Phones: the circles under "Learning with fun" slide along by themselves
  // (and can be swiped), looping round without jumping back to the start.
  const slider = document.querySelector(".joy__circles");
  if (slider) {
    const phone = window.matchMedia("(max-width: 640px)");
    const bubbles = [...slider.querySelectorAll(".bubble")];
    const colourOf = (el) => [...el.classList].find((c) => c.startsWith("c-")) || "";
    const dots = document.createElement("div");
    dots.className = "joy__dots";
    dots.innerHTML = bubbles
      .map((b, i) => `<button type="button" class="${colourOf(b)}" data-slide="${i}" aria-label="Show ${b.textContent.trim().replace(/"/g, "")}"></button>`)
      .join("");
    slider.after(dots);

    const SLIDE_EVERY = 3000;
    const REST_AFTER_TOUCH = 5000;
    let active = null;
    let lastTouch = 0;
    let visible = false;
    let playTimer;
    let settleTimer;
    let frame;

    const items = () => [...slider.querySelectorAll(".bubble")];
    const realOf = (el) => (el.dataset.cloneOf ? bubbles[Number(el.dataset.cloneOf)] : el);
    // scrollLeft that puts an item in the middle
    const offsetFor = (el) => {
      const box = slider.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return slider.scrollLeft + r.left + r.width / 2 - (box.left + box.width / 2);
    };
    const nearest = () => items().reduce((best, el) => (Math.abs(offsetFor(el) - slider.scrollLeft) < Math.abs(offsetFor(best) - slider.scrollLeft) ? el : best));
    const mark = (el) => {
      active = el;
      items().forEach((b) => b.classList.toggle("is-active", b === el));
      const real = realOf(el);
      [...dots.children].forEach((d, i) => d.setAttribute("aria-current", String(bubbles[i] === real)));
    };
    // Put an item in the middle straight away, without animating
    const jumpTo = (el) => {
      slider.classList.add("no-anim");
      mark(el);
      slider.scrollLeft = offsetFor(el);
      requestAnimationFrame(() => requestAnimationFrame(() => slider.classList.remove("no-anim")));
    };
    const slideTo = (el) => slider.scrollTo({ left: offsetFor(el), behavior: reduceMotion ? "auto" : "smooth" });

    // Once scrolling stops on a copy at either end, swap to the real circle
    const settle = () => {
      const el = nearest();
      if (el.dataset.cloneOf) jumpTo(realOf(el));
      else mark(el);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => mark(nearest()));
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, 150);
    };

    const play = () => {
      clearTimeout(playTimer);
      if (reduceMotion) return;
      playTimer = setTimeout(() => {
        if (visible && !document.hidden && Date.now() - lastTouch > REST_AFTER_TOUCH && active) {
          const list = items();
          slideTo(list[list.indexOf(active) + 1] || list[0]);
        }
        play();
      }, SLIDE_EVERY);
    };
    const touched = () => {
      lastTouch = Date.now();
    };

    const makeClone = (el) => {
      const copy = el.cloneNode(true);
      copy.removeAttribute("data-reveal");
      copy.classList.add("is-in");
      copy.setAttribute("aria-hidden", "true");
      copy.dataset.cloneOf = String(bubbles.indexOf(el));
      return copy;
    };

    const start = () => {
      slider.prepend(makeClone(bubbles[bubbles.length - 1]));
      slider.append(makeClone(bubbles[0]));
      slider.classList.add("is-sliding");
      jumpTo(bubbles[0]);
      slider.addEventListener("scroll", onScroll, { passive: true });
      play();
    };
    const stop = () => {
      clearTimeout(playTimer);
      clearTimeout(settleTimer);
      slider.removeEventListener("scroll", onScroll);
      slider.querySelectorAll("[data-clone-of]").forEach((el) => el.remove());
      slider.classList.remove("is-sliding");
      bubbles.forEach((b) => b.classList.remove("is-active"));
      slider.scrollLeft = 0;
      active = null;
    };

    ["touchstart", "touchend", "pointerdown", "wheel"].forEach((type) => slider.addEventListener(type, touched, { passive: true }));
    dots.addEventListener("click", (event) => {
      const dot = event.target.closest("[data-slide]");
      if (!dot) return;
      touched();
      slideTo(bubbles[Number(dot.dataset.slide)]);
    });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => (visible = entries[0].isIntersecting), { threshold: 0.4 }).observe(slider);
    } else {
      visible = true;
    }
    // Re-centre after a rotation (phones also "resize" when the address bar hides)
    let width = window.innerWidth;
    window.addEventListener("resize", () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      if (active) jumpTo(realOf(active));
    });
    phone.addEventListener("change", (event) => (event.matches ? start() : stop()));
    if (phone.matches) start();
  }

  // Keep the copyright year current
  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });

  // Pre-select the enquiry topic from links like contact.html?topic=tour
  const topic = new URLSearchParams(window.location.search).get("topic");
  const topicSelect = document.querySelector('select[name="topic"]');
  if (topic && topicSelect && [...topicSelect.options].some((option) => option.value === topic)) {
    topicSelect.value = topic;
  }

  // Forms: send in the background to the form service in data-endpoint, which
  // emails the daycare. If that fails, offer a link that opens the visitor's
  // email app with the message filled in.
  const humanize = (name) => name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

  document.querySelectorAll("form[data-form]").forEach((form) => {
    const status = form.querySelector(".form-status");
    const submit = form.querySelector('[type="submit"]');
    const submitLabel = submit.textContent;

    const showStatus = (type, ...content) => {
      status.className = `form-status is-${type}`;
      status.replaceChildren(...content);
      status.focus();
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const data = new FormData(form);
      if (data.get("_honey")) return; // spam bot filled the hidden field

      // Visible fields, with ticked boxes that share a name joined together
      const fields = new Map();
      for (const [name, value] of data) {
        if (name.startsWith("_") || !String(value).trim()) continue;
        fields.set(name, fields.has(name) ? `${fields.get(name)}, ${value}` : String(value));
      }
      // Dropdowns: send the wording the visitor picked ("Book a tour"), not its code ("tour")
      form.querySelectorAll("select").forEach((select) => {
        if (fields.has(select.name) && select.selectedOptions[0]) fields.set(select.name, select.selectedOptions[0].text);
      });
      const subject = data.get("_subject") || "Website enquiry";

      const emailLink = () => {
        const body = [...fields].map(([name, value]) => `${humanize(name)}: ${value}`).join("\n");
        const link = document.createElement("a");
        link.href = `mailto:${form.dataset.mailto}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        link.textContent = `email it to ${form.dataset.mailto}`;
        return link;
      };

      const endpoint = form.dataset.endpoint;
      if (!endpoint) {
        showStatus("error", "Please ", emailLink(), " — your message will be filled in for you.");
        return;
      }

      submit.disabled = true;
      submit.textContent = "Sending…";
      try {
        const who = fields.get("parent_name") || fields.get("name");
        const payload = { _subject: who ? `${subject}: ${who}` : subject, _template: data.get("_template") || "table", _captcha: "false" };
        if (fields.has("email")) payload._replyto = fields.get("email");
        fields.forEach((value, name) => (payload[humanize(name)] = value));
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        // Formspree answers { ok: true }; FormSubmit answers { success: "true" | "false" }
        if (!response.ok || String(result.success) === "false") throw new Error(result.message || `Request failed: ${response.status}`);
        form.reset();
        showStatus("success", form.dataset.success);
      } catch (error) {
        showStatus("error", "Sorry, your message didn’t go through. Please try again, or ", emailLink(), " — your message will be filled in for you.");
      } finally {
        submit.disabled = false;
        submit.textContent = submitLabel;
      }
    });
  });
})();
