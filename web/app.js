"use strict";

(() => {
  const translations = {
    en: {
      language: "Language", home: "s4cred home", createPageTitle: "s4cred — private notes", readPageTitle: "s4cred — open a note", light: "Light", dark: "Dark", switchLight: "Switch to light theme", switchDark: "Switch to dark theme",
      eyebrow: "PRIVATE BY DESIGN", createTitle: "A little secret,\nshared safely.", createLead: "Write a note, share a link, and let it disappear after one read.",
      noteLabel: "Your secret note", notePlaceholder: "Write something worth keeping private...", noteHelp: "Encrypted in your browser. Maximum 1,000,000 UTF-8 bytes.",
      expires: "Expires after", oneHour: "1 hour", oneDay: "24 hours", sevenDays: "7 days", protect: "Protect with a password", optional: "Optional extra protection",
      password: "Password", confirmPassword: "Confirm password", passwordHelp: "Choose a strong, unique password (12+ characters recommended). Share it separately; it cannot be recovered.",
      createButton: "Create secret link", creating: "Encrypting and creating...", createdTitle: "Your link is ready.", createdLead: "Anyone with this link can attempt to open your note. Share it carefully.",
      linkLabel: "Single-use link", copy: "Copy", copied: "Copied to clipboard.", copyFailed: "Clipboard unavailable. Select the text and copy it manually.",
      sharePassword: "Send the password through a separate channel. It is not included in the link.", createAnother: "Create another note →",
      incoming: "A NOTE FOR YOU", readTitle: "Someone sent you\na secret.", readLead: "Take a moment before you open it.", warningTitle: "This note can only be read once.",
      warningBody: "Confirming deletes it before delivery. A lost connection, incorrect key, or decryption error can make it unrecoverable.",
      readPasswordHelp: "Enter the password shared with you separately. An incorrect password will not consume the note.", readButton: "Open and delete note", opening: "Opening...",
      openedTitle: "The note is yours.", openedLead: "It has been deleted from the service. Save anything you need now.", footer: "Encrypted on your device · No account needed · One read only",
      cryptoError: "Web Crypto is unavailable. Use a modern browser over HTTPS (or localhost).", emptyNote: "Enter a note before creating a link.", tooLarge: "The note exceeds the 1,000,000-byte UTF-8 limit.",
      passwordRequired: "Enter a password.", passwordMismatch: "The passwords do not match.", invalidLink: "This link is missing or invalid. Check that you copied the complete link.",
      wrongPassword: "Incorrect password. This attempt did not send a read request; you can try again.", notFound: "This note does not exist, has expired, or has already been read.",
      invalidNote: "The note could not be accepted. Check your input and try again.", capacity: "The service is at capacity. Please try again later.", origin: "This request was blocked by the service's origin policy.",
      internal: "The service could not complete the request. Please try again later.", createNetwork: "Could not confirm creation. A note may have been stored and will expire automatically; please try again.",
      readNetwork: "The read could not be confirmed. The note may already have been deleted and cannot be recovered.", decryptError: "The note was retrieved but could not be decrypted. It has already been deleted and cannot be recovered.",
      linkChanged: "The link changed. Check it before confirming the read.", readChangedAfterRequest: "The link changed after a read was requested. The previous note may already have been deleted and cannot be recovered.",
      bytes: "bytes"
    },
    pl: {
      language: "Język", home: "Strona główna s4cred", createPageTitle: "s4cred — prywatne notatki", readPageTitle: "s4cred — otwórz notatkę", light: "Jasny", dark: "Ciemny", switchLight: "Włącz jasny motyw", switchDark: "Włącz ciemny motyw",
      eyebrow: "PRYWATNOŚĆ OD PODSTAW", createTitle: "Mały sekret,\nbezpiecznie przekazany.", createLead: "Napisz notatkę, udostępnij link i pozwól jej zniknąć po jednym odczycie.",
      noteLabel: "Twoja tajna notatka", notePlaceholder: "Napisz coś, co ma pozostać prywatne...", noteHelp: "Szyfrowanie odbywa się w przeglądarce. Maksymalnie 1 000 000 bajtów UTF-8.",
      expires: "Wygasa po", oneHour: "1 godzinie", oneDay: "24 godzinach", sevenDays: "7 dniach", protect: "Zabezpiecz hasłem", optional: "Dodatkowa ochrona, opcjonalnie",
      password: "Hasło", confirmPassword: "Potwierdź hasło", passwordHelp: "Wybierz silne, unikalne hasło (zalecamy co najmniej 12 znaków). Przekaż je osobno; nie można go odzyskać.",
      createButton: "Utwórz tajny link", creating: "Szyfrowanie i tworzenie...", createdTitle: "Twój link jest gotowy.", createdLead: "Każdy, kto ma ten link, może spróbować otworzyć notatkę. Udostępniaj go ostrożnie.",
      linkLabel: "Link jednorazowy", copy: "Kopiuj", copied: "Skopiowano do schowka.", copyFailed: "Schowek jest niedostępny. Zaznacz tekst i skopiuj go ręcznie.",
      sharePassword: "Przekaż hasło innym kanałem. Nie znajduje się ono w linku.", createAnother: "Utwórz kolejną notatkę →",
      incoming: "NOTATKA DLA CIEBIE", readTitle: "Ktoś przesłał Ci\nsekret.", readLead: "Zatrzymaj się na chwilę przed otwarciem.", warningTitle: "Tę notatkę można odczytać tylko raz.",
      warningBody: "Potwierdzenie usuwa ją przed dostarczeniem. Utrata połączenia, błędny klucz lub błąd odszyfrowania mogą uniemożliwić jej odzyskanie.",
      readPasswordHelp: "Wpisz hasło przekazane osobno. Błędne hasło nie spowoduje odczytania notatki.", readButton: "Otwórz i usuń notatkę", opening: "Otwieranie...",
      openedTitle: "Notatka należy do Ciebie.", openedLead: "Została usunięta z serwisu. Zapisz teraz wszystko, czego potrzebujesz.", footer: "Szyfrowanie na urządzeniu · Bez konta · Jeden odczyt",
      cryptoError: "Web Crypto jest niedostępne. Użyj nowoczesnej przeglądarki przez HTTPS (lub localhost).", emptyNote: "Wpisz notatkę przed utworzeniem linku.", tooLarge: "Notatka przekracza limit 1 000 000 bajtów UTF-8.",
      passwordRequired: "Wpisz hasło.", passwordMismatch: "Hasła nie są takie same.", invalidLink: "Link jest niekompletny lub nieprawidłowy. Sprawdź, czy został skopiowany w całości.",
      wrongPassword: "Nieprawidłowe hasło. Ta próba nie wysłała żądania odczytu; możesz spróbować ponownie.", notFound: "Notatka nie istnieje, wygasła lub została już odczytana.",
      invalidNote: "Nie można przyjąć notatki. Sprawdź dane i spróbuj ponownie.", capacity: "Serwis osiągnął limit pojemności. Spróbuj ponownie później.", origin: "Żądanie zostało zablokowane przez politykę pochodzenia serwisu.",
      internal: "Serwis nie mógł wykonać żądania. Spróbuj ponownie później.", createNetwork: "Nie udało się potwierdzić utworzenia. Notatka mogła zostać zapisana i wygaśnie automatycznie; spróbuj ponownie.",
      readNetwork: "Nie udało się potwierdzić odczytu. Notatka mogła już zostać usunięta i nie można jej odzyskać.", decryptError: "Pobrano notatkę, ale nie udało się jej odszyfrować. Została już usunięta i nie można jej odzyskać.",
      linkChanged: "Link się zmienił. Sprawdź go przed potwierdzeniem odczytu.", readChangedAfterRequest: "Link zmienił się po wysłaniu żądania odczytu. Poprzednia notatka mogła już zostać usunięta i nie można jej odzyskać.",
      bytes: "bajtów"
    }
  };

  const $ = (id) => document.getElementById(id);
  const encoder = new TextEncoder();
  const limit = 1000000;
  const preference = (name) => { try { return localStorage.getItem(name); } catch (_) { return null; } };
  const savePreference = (name, value) => { try { localStorage.setItem(name, value); } catch (_) { /* Preferences are optional. */ } };
  const detectedLanguage = () => {
    for (const language of navigator.languages || [navigator.language]) {
      const primary = (language || "").toLowerCase().split("-")[0];
      if (primary === "en" || primary === "pl") return primary;
    }
    return "en";
  };
  const storedLanguage = preference("s4cred-language");
  let language = storedLanguage === "en" || storedLanguage === "pl" ? storedLanguage : detectedLanguage();
  let theme = preference("s4cred-theme") === "light" ? "light" : "dark";
  let createBusy = false;
  let readBusy = false;
  let fragment = null;
  let noteID = null;
  let readLocation = location.href;
  let readRevision = 0;
  let readAttempt = null;
  let readUncertain = false;
  const cryptoAvailable = !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues);

  function text(key) { return translations[language][key]; }
  function setMessage(element, key) {
    element.dataset.message = key || "";
    element.hidden = !key;
    element.textContent = key ? text(key) : "";
  }
  function updateCount() {
    const size = encoder.encode($("note").value).length;
    $("byte-count").textContent = `${size.toLocaleString(language)} / ${(limit).toLocaleString(language)} ${text("bytes")}`;
    return size;
  }
  function render() {
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = theme;
    document.title = text(location.pathname.startsWith("/n/") ? "readPageTitle" : "createPageTitle");
    $("language").value = language;
    $("language").setAttribute("aria-label", text("language"));
    document.querySelector(".brand").setAttribute("aria-label", text("home"));
    $("theme").setAttribute("aria-label", text(theme === "dark" ? "switchLight" : "switchDark"));
    $("theme-label").textContent = text(theme === "dark" ? "light" : "dark");
    for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = text(element.dataset.i18n);
    for (const element of document.querySelectorAll("[data-i18n-placeholder]")) element.placeholder = text(element.dataset.i18nPlaceholder);
    for (const element of document.querySelectorAll("[data-message]")) if (element.dataset.message) element.textContent = text(element.dataset.message);
    $("opened-note").setAttribute("aria-label", text("noteLabel"));
    $("create-button").firstElementChild.textContent = text(createBusy ? "creating" : "createButton");
    $("read-button").firstElementChild.textContent = text(readBusy ? "opening" : "readButton");
    updateCount();
  }

  function randomBytes(length) { return crypto.getRandomValues(new Uint8Array(length)); }
  function encode64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decode64(value, size) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error("Invalid encoding");
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if ((size !== undefined && bytes.length !== size) || encode64(bytes) !== value) throw new Error("Invalid encoding");
    return bytes;
  }
  async function aesKey(raw, usage) { return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [usage]); }
  async function passwordKey(password, salt) {
    const material = await crypto.subtle.importKey("raw", encoder.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function makeFragment(key, token, password) {
    if (password === null) return `v1.${encode64(key)}.${encode64(token)}`;
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const pair = new Uint8Array(64);
    pair.set(key);
    pair.set(token, 32);
    const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await passwordKey(password, salt), pair));
    return `v1p.${encode64(salt)}.${encode64(nonce)}.${encode64(wrapped)}`;
  }
  function parseFragment(value) {
    const parts = value.split(".");
    if (parts[0] === "v1" && parts.length === 3) return { version: "v1", key: decode64(parts[1], 32), token: decode64(parts[2], 32) };
    if (parts[0] === "v1p" && parts.length === 4) return { version: "v1p", salt: decode64(parts[1], 16), nonce: decode64(parts[2], 12), wrapped: decode64(parts[3], 80) };
    throw new Error("Invalid fragment");
  }
  async function unwrapFragment(password, protectedFragment) {
    const pair = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: protectedFragment.nonce }, await passwordKey(password, protectedFragment.salt), protectedFragment.wrapped));
    if (pair.length !== 64) throw new Error("Invalid package");
    return { key: pair.slice(0, 32), token: pair.slice(32) };
  }
  async function request(path, body) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", redirect: "error" });
    let data;
    try { data = await response.json(); } catch (_) { throw new Error("network"); }
    if (!response.ok) {
      const errors = { invalid_note: "invalidNote", not_found: "notFound", capacity_exceeded: "capacity", origin_forbidden: "origin", too_large: "tooLarge", internal_error: "internal" };
      const error = new Error("api");
      error.messageKey = errors[data && data.error] || "internal";
      throw error;
    }
    return data;
  }
  function setBusy(which, busy) {
    if (which === "create") createBusy = busy;
    else readBusy = busy;
    $(`${which}-button`).disabled = busy || !cryptoAvailable || (which === "read" && (!fragment || !noteID));
    render();
  }
  function refreshReadLink(changed) {
    readRevision++;
    readLocation = location.href;
    fragment = null;
    noteID = null;
    $("read-password").value = "";
    $("read-password-field").hidden = true;
    $("opened-note").textContent = "";
    $("opened").hidden = true;
    $("read-confirm").hidden = false;
    setMessage($("note-copy-status"), null);
    setMessage($("read-error"), null);
    if (changed) setMessage($("read-interrupted"), readUncertain ? "readChangedAfterRequest" : "linkChanged");
    try {
      const match = /^\/n\/([A-Za-z0-9_-]+)$/.exec(location.pathname);
      if (!match) throw new Error("Invalid path");
      decode64(match[1], 32);
      const parsed = parseFragment(location.hash.slice(1));
      noteID = match[1];
      fragment = parsed;
      $("read-password-field").hidden = fragment.version !== "v1p";
    } catch (_) { setMessage($("read-error"), "invalidLink"); }
    $("read-button").disabled = readBusy || !fragment || !noteID || !cryptoAvailable;
  }

  $("language").addEventListener("change", (event) => { language = event.target.value; savePreference("s4cred-language", language); render(); });
  $("theme").addEventListener("click", () => { theme = theme === "dark" ? "light" : "dark"; savePreference("s4cred-theme", theme); render(); });
  $("note").addEventListener("input", updateCount);
  $("protect").addEventListener("change", () => {
    $("password-fields").hidden = !$("protect").checked;
    if (!$("protect").checked) { $("create-password").value = ""; $("confirm-password").value = ""; }
  });
  $("create-another").addEventListener("click", () => { $("link").value = ""; $("created").hidden = true; $("create-form").hidden = false; setMessage($("link-copy-status"), null); $("note").focus(); });

  $("create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (createBusy) return;
    setMessage($("create-error"), null);
    const plaintext = encoder.encode($("note").value);
    if (!plaintext.length) return setMessage($("create-error"), "emptyNote");
    if (plaintext.length > limit) return setMessage($("create-error"), "tooLarge");
    const protectedLink = $("protect").checked;
    const password = protectedLink ? $("create-password").value : null;
    if (protectedLink && !password) return setMessage($("create-error"), "passwordRequired");
    if (protectedLink && password.normalize("NFC") !== $("confirm-password").value.normalize("NFC")) return setMessage($("create-error"), "passwordMismatch");
    if (!["3600", "86400", "604800"].includes($("ttl").value)) return setMessage($("create-error"), "invalidNote");
    setBusy("create", true);
    let requestStarted = false;
    try {
      const key = randomBytes(32), token = randomBytes(32), nonce = randomBytes(12);
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await aesKey(key, "encrypt"), plaintext));
      const tokenHash = new Uint8Array(await crypto.subtle.digest("SHA-256", token));
      const linkFragment = await makeFragment(key, token, password);
      requestStarted = true;
      const result = await request("/api/notes", { ciphertext: encode64(ciphertext), nonce: encode64(nonce), ttl: Number($("ttl").value), read_token_hash: encode64(tokenHash) });
      decode64(result.id, 32);
      $("link").value = `${location.origin}/n/${result.id}#${linkFragment}`;
      $("share-password").hidden = !protectedLink;
      $("note").value = "";
      $("create-password").value = "";
      $("confirm-password").value = "";
      $("protect").checked = false;
      $("password-fields").hidden = true;
      $("create-form").hidden = true;
      $("created").hidden = false;
      $("link").focus();
      $("link").select();
    } catch (error) {
      setMessage($("create-error"), error.messageKey || (requestStarted ? "createNetwork" : "internal"));
    } finally { setBusy("create", false); }
  });

  $("read-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (readLocation !== location.href) refreshReadLink(true);
    if (readBusy || !fragment || !noteID) return;
    setMessage($("read-error"), null);
    if (fragment.version === "v1p" && !$("read-password").value) return setMessage($("read-error"), "passwordRequired");
    const attempt = { href: location.href, revision: readRevision, fragment, noteID, sent: false };
    const password = $("read-password").value;
    const current = () => attempt.href === location.href && attempt.revision === readRevision;
    readAttempt = attempt;
    setBusy("read", true);
    try {
      let credentials;
      if (attempt.fragment.version === "v1p") {
        try { credentials = await unwrapFragment(password, attempt.fragment); }
        catch (_) { if (current()) setMessage($("read-error"), "wrongPassword"); return; }
      } else credentials = attempt.fragment;
      if (!current()) return;
      attempt.sent = true;
      let result;
      try { result = await request(`/api/notes/${attempt.noteID}/consume`, { read_token: encode64(credentials.token) }); }
      catch (error) { if (current()) setMessage($("read-error"), error.messageKey || "readNetwork"); return; }
      if (!current()) return;
      try {
        const ciphertext = decode64(result.ciphertext);
        if (ciphertext.length < 17 || ciphertext.length > limit + 16) throw new Error("Invalid ciphertext");
        const nonce = decode64(result.nonce, 12);
        const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await aesKey(credentials.key, "decrypt"), ciphertext);
        if (!current()) return;
        $("opened-note").textContent = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
        $("read-password").value = "";
        $("read-confirm").hidden = true;
        $("opened").hidden = false;
        $("opened-note").focus();
      } catch (_) { if (current()) setMessage($("read-error"), "decryptError"); }
    } finally {
      if (!current()) {
        if (attempt.sent) readUncertain = true;
        if (readLocation !== location.href) refreshReadLink(true);
        else if (attempt.sent) setMessage($("read-interrupted"), "readChangedAfterRequest");
      }
      readAttempt = null;
      setBusy("read", false);
    }
  });

  async function copy(value, status, fallback) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setMessage(status, "copied");
    } catch (_) {
      setMessage(status, "copyFailed");
      if (fallback.select) fallback.select();
      else {
        const range = document.createRange();
        range.selectNodeContents(fallback);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      fallback.focus();
    }
  }
  $("copy-link").addEventListener("click", () => copy($("link").value, $("link-copy-status"), $("link")));
  $("copy-note").addEventListener("click", () => copy($("opened-note").textContent, $("note-copy-status"), $("opened-note")));

  const isRead = location.pathname.startsWith("/n/");
  $(isRead ? "read-view" : "create-view").hidden = false;
  if (isRead) {
    refreshReadLink(false);
    window.addEventListener("hashchange", (event) => {
      const interrupted = readAttempt && event.oldURL === readAttempt.href;
      if (interrupted && readAttempt.sent) readUncertain = true;
      if (readLocation !== location.href || interrupted) refreshReadLink(true);
    });
  }
  if (!cryptoAvailable) {
    setMessage($("crypto-error"), "cryptoError");
    $("create-button").disabled = true;
    $("read-button").disabled = true;
  }
  render();
})();
