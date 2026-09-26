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

  // Forms: post to a form service when an action URL is set (e.g. Formspree),
  // otherwise open the visitor's email app with the message filled in.
  const humanize = (name) => name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

  document.querySelectorAll("form[data-form]").forEach((form) => {
    const status = form.querySelector(".form-status");
    const submit = form.querySelector('[type="submit"]');

    const showStatus = (type, message) => {
      status.className = `form-status is-${type}`;
      status.textContent = message;
      status.focus();
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const data = new FormData(form);
      if (data.get("_gotcha")) return; // spam bot filled the hidden field

      const endpoint = form.getAttribute("action");
      if (endpoint) {
        submit.disabled = true;
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            body: data,
            headers: { Accept: "application/json" },
          });
          if (!response.ok) throw new Error(`Request failed: ${response.status}`);
          form.reset();
          showStatus("success", form.dataset.success);
        } catch (error) {
          showStatus("error", "Sorry, your message could not be sent. Please call or email us instead.");
        } finally {
          submit.disabled = false;
        }
        return;
      }

      const fields = new Map();
      for (const [name, value] of data) {
        if (name.startsWith("_") || !String(value).trim()) continue;
        fields.set(name, fields.has(name) ? `${fields.get(name)}, ${value}` : String(value));
      }
      const body = [...fields].map(([name, value]) => `${humanize(name)}: ${value}`).join("\n");
      const subject = encodeURIComponent(form.dataset.subject || "Website enquiry");
      window.location.href = `mailto:${form.dataset.mailto}?subject=${subject}&body=${encodeURIComponent(body)}`;
      showStatus("success", "Your email app should now open with your message ready to send. Just press send!");
    });
  });
})();
