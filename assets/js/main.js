/* Aflah Daycare — small progressive enhancements. The site works without JavaScript. */
(() => {
  const header = document.querySelector(".site-header");
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");

  // Mobile navigation
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
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // Fade sections in as they scroll into view
  const revealItems = document.querySelectorAll(".reveal");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if ("IntersectionObserver" in window && !reduceMotion) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add("is-visible"));
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
