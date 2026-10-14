"use strict";
const form = document.querySelector("#authForm");
const errorEl = document.querySelector("#formError");
const submitBtn = document.querySelector("#submitButton");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  submitBtn.disabled = true;
  const body = Object.fromEntries(new FormData(form));
  try {
    const response = await fetch(`/api/auth/${form.dataset.mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Não foi possível continuar.");
    window.location.assign("/app");
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    submitBtn.disabled = false;
  }
});
