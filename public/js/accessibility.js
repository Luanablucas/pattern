"use strict";
(() => {
  const nav = document.querySelector(".nav-list");
  if (!nav) return;
  const links = [...nav.querySelectorAll("a.nav-link")];
  const active = nav.querySelector('[aria-current="page"]');
  if (active && window.matchMedia("(max-width: 700px)").matches) {
    const navRect = nav.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.left < navRect.left || activeRect.right > navRect.right) {
      nav.scrollLeft += activeRect.left - navRect.left - (navRect.width - activeRect.width) / 2;
    }
  }
  nav.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const link = event.target.closest("a.nav-link");
    const index = links.indexOf(link);
    if (index === -1) return;
    const next = Math.max(0, Math.min(links.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
    if (next === index) return;
    event.preventDefault();
    links[next].focus();
  });
})();
