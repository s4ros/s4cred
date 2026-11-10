"use strict";

(() => {
  const translations = {
    en: {
      language: "Language", home: "s4cred home", createPageTitle: "s4cred — private notes", readPageTitle: "s4cred — open a note", light: "Light", dark: "Dark", switchLight: "Switch to light theme", switchDark: "Switch to dark theme",
      eyebrow: "PRIVATE BY DESIGN", createTitle: "A little secret,\nshared safely.", createLead: "Write a note, share a link, and let it disappear after one read.",
      noteLabel: "Your secret note", notePlaceholder: "Write something worth keeping private...", noteHelp: "Encrypted in your browser. Maximum 1,000,000 UTF-8 bytes.",
      expires: "Expires after", oneHour: "1 hour", oneDay: "24 hours", sevenDays: "7 days", protect: "Protect with a password", optional: "Optional extra protection",
      password: "Password", confirmPassword: "Confirm password", passwordHelp: "Choose a strong, unique password (12+ characters recommended). Share it separately; it cannot be recovered.",
      createButton: "Create secret link", creating: "Encrypting and creating...", createdTitle: "Your link is ready.", createdLead: "This short link is the whole secret. Anyone who can see it can try to open the note. Share it carefully.",
      linkLabel: "Single-use link", copy: "Copy", copied: "Copied to clipboard.", copyFailed: "Clipboard unavailable. Select the text and copy it manually.",
      sharePassword: "Send the password through a separate channel. It is not included in the link.", createAnother: "Create another note →",
      incoming: "A NOTE FOR YOU", readTitle: "Someone sent you\na secret.", readLead: "Take a moment before you open it.", warningTitle: "This note can only be read once.",
      warningBody: "Confirming deletes it before delivery. A lost connection, incorrect key, or decryption error can make it unrecoverable.",
      readPasswordHelp: "Enter the password shared with you separately. An incorrect password will not consume the note.", readButton: "Open and delete note", opening: "Opening...",
      openedTitle: "The note is yours.", openedLead: "It has been deleted from the service. Save anything you need now.", footer: "Encrypted on your device · No account needed · One read only", credit: "Created by Stefan",
      cryptoError: "Web Crypto is unavailable. Use a modern browser over HTTPS (or localhost).", emptyNote: "Enter a note before creating a link.", tooLarge: "The note exceeds the 1,000,000-byte UTF-8 limit.",
      passwordRequired: "Enter a password.", passwordMismatch: "The passwords do not match.", invalidLink: "This link is missing or invalid. Check that you copied the complete link.",
      wrongPassword: "Incorrect password. This attempt did not send a read request; you can try again.", notFound: "This note does not exist, has expired, or has already been read.",
      invalidNote: "The note could not be accepted. Check your input and try again.", capacity: "The service is at capacity. Please try again later.", origin: "This request was blocked by the service's origin policy.",
      internal: "The service could not complete the request. Please try again later.", createNetwork: "Could not confirm creation. A note may have been stored and will expire automatically; please try again.",
      readNetwork: "The read could not be confirmed. The note may already have been deleted and cannot be recovered.", materialNetwork: "Could not load this link. The note was not opened or deleted; check the link and try again.", decryptError: "The note was retrieved but could not be decrypted. It has already been deleted and cannot be recovered.",
      linkChanged: "The link changed. Check it before confirming the read.", readChangedAfterRequest: "The link changed after a read was requested. The previous note may already have been deleted and cannot be recovered.",
      bytes: "bytes",
      payloadKind: "Secret type", modeNote: "Note", modeFile: "File", fileLabel: "File",
      fileHelp: "Encrypted in your browser before upload. Maximum 32 MiB. One file.",
      fileEmpty: "Choose a file.", fileTooLarge: "The file exceeds 32 MiB.", fileNameTooLong: "The file name exceeds 255 bytes.",
      encrypting: "Encrypting…", uploading: "Uploading…",
      fileWarningTitle: "This file can only be downloaded once.",
      fileWarningBody: "Confirming deletes it before delivery. A lost connection or decryption error can make it unrecoverable.",
      continueButton: "Continue", fileReadButton: "Download and delete file",
      fileReadyTitle: "The file is yours.", fileReadyLead: "It has been deleted from the service. Save it now.", download: "Download"
    },
    pl: {
      language: "Język", home: "Strona główna s4cred", createPageTitle: "s4cred — prywatne notatki", readPageTitle: "s4cred — otwórz notatkę", light: "Jasny", dark: "Ciemny", switchLight: "Włącz jasny motyw", switchDark: "Włącz ciemny motyw",
      eyebrow: "PRYWATNOŚĆ OD PODSTAW", createTitle: "Mały sekret,\nbezpiecznie przekazany.", createLead: "Napisz notatkę, udostępnij link i pozwól jej zniknąć po jednym odczycie.",
      noteLabel: "Twoja tajna notatka", notePlaceholder: "Napisz coś, co ma pozostać prywatne...", noteHelp: "Szyfrowanie odbywa się w przeglądarce. Maksymalnie 1 000 000 bajtów UTF-8.",
      expires: "Wygasa po", oneHour: "1 godzinie", oneDay: "24 godzinach", sevenDays: "7 dniach", protect: "Zabezpiecz hasłem", optional: "Dodatkowa ochrona, opcjonalnie",
      password: "Hasło", confirmPassword: "Potwierdź hasło", passwordHelp: "Wybierz silne, unikalne hasło (zalecamy co najmniej 12 znaków). Przekaż je osobno; nie można go odzyskać.",
      createButton: "Utwórz tajny link", creating: "Szyfrowanie i tworzenie...", createdTitle: "Twój link jest gotowy.", createdLead: "Ten krótki link jest całym sekretem. Każdy, kto go zobaczy, może spróbować otworzyć notatkę. Udostępniaj go ostrożnie.",
      linkLabel: "Link jednorazowy", copy: "Kopiuj", copied: "Skopiowano do schowka.", copyFailed: "Schowek jest niedostępny. Zaznacz tekst i skopiuj go ręcznie.",
      sharePassword: "Przekaż hasło innym kanałem. Nie znajduje się ono w linku.", createAnother: "Utwórz kolejną notatkę →",
      incoming: "NOTATKA DLA CIEBIE", readTitle: "Ktoś przesłał Ci\nsekret.", readLead: "Zatrzymaj się na chwilę przed otwarciem.", warningTitle: "Tę notatkę można odczytać tylko raz.",
      warningBody: "Potwierdzenie usuwa ją przed dostarczeniem. Utrata połączenia, błędny klucz lub błąd odszyfrowania mogą uniemożliwić jej odzyskanie.",
      readPasswordHelp: "Wpisz hasło przekazane osobno. Błędne hasło nie spowoduje odczytania notatki.", readButton: "Otwórz i usuń notatkę", opening: "Otwieranie...",
      openedTitle: "Notatka należy do Ciebie.", openedLead: "Została usunięta z serwisu. Zapisz teraz wszystko, czego potrzebujesz.", footer: "Szyfrowanie na urządzeniu · Bez konta · Jeden odczyt", credit: "Stworzone przez Stefana",
      cryptoError: "Web Crypto jest niedostępne. Użyj nowoczesnej przeglądarki przez HTTPS (lub localhost).", emptyNote: "Wpisz notatkę przed utworzeniem linku.", tooLarge: "Notatka przekracza limit 1 000 000 bajtów UTF-8.",
      passwordRequired: "Wpisz hasło.", passwordMismatch: "Hasła nie są takie same.", invalidLink: "Link jest niekompletny lub nieprawidłowy. Sprawdź, czy został skopiowany w całości.",
      wrongPassword: "Nieprawidłowe hasło. Ta próba nie wysłała żądania odczytu; możesz spróbować ponownie.", notFound: "Notatka nie istnieje, wygasła lub została już odczytana.",
      invalidNote: "Nie można przyjąć notatki. Sprawdź dane i spróbuj ponownie.", capacity: "Serwis osiągnął limit pojemności. Spróbuj ponownie później.", origin: "Żądanie zostało zablokowane przez politykę pochodzenia serwisu.",
      internal: "Serwis nie mógł wykonać żądania. Spróbuj ponownie później.", createNetwork: "Nie udało się potwierdzić utworzenia. Notatka mogła zostać zapisana i wygaśnie automatycznie; spróbuj ponownie.",
      readNetwork: "Nie udało się potwierdzić odczytu. Notatka mogła już zostać usunięta i nie można jej odzyskać.", materialNetwork: "Nie udało się wczytać linku. Notatka nie została otwarta ani usunięta; sprawdź link i spróbuj ponownie.", decryptError: "Pobrano notatkę, ale nie udało się jej odszyfrować. Została już usunięta i nie można jej odzyskać.",
      linkChanged: "Link się zmienił. Sprawdź go przed potwierdzeniem odczytu.", readChangedAfterRequest: "Link zmienił się po wysłaniu żądania odczytu. Poprzednia notatka mogła już zostać usunięta i nie można jej odzyskać.",
      bytes: "bajtów",
      payloadKind: "Rodzaj sekretu", modeNote: "Notatka", modeFile: "Plik", fileLabel: "Plik",
      fileHelp: "Szyfrowane w przeglądarce przed wysłaniem. Maksymalnie 32 MiB. Jeden plik.",
      fileEmpty: "Wybierz plik.", fileTooLarge: "Plik przekracza 32 MiB.", fileNameTooLong: "Nazwa pliku przekracza 255 bajtów.",
      encrypting: "Szyfrowanie…", uploading: "Wysyłanie…",
      fileWarningTitle: "Ten plik można pobrać tylko raz.",
      fileWarningBody: "Potwierdzenie kasuje go przed dostarczeniem. Utracone połączenie lub błąd odszyfrowania może uniemożliwić odzyskanie.",
      continueButton: "Dalej", fileReadButton: "Pobierz i usuń plik",
      fileReadyTitle: "Plik jest twój.", fileReadyLead: "Został usunięty z usługi. Zapisz go teraz.", download: "Pobierz"
    }
  };

  const $ = (id) => document.getElementById(id);
  const encoder = new TextEncoder();
  const limit = 1000000;
  const fileLimit = 33554432;
  const metaAAD = encoder.encode("s4cred-file-meta-v1");
  const fileAAD = encoder.encode("s4cred-file-body-v1");
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
  let pendingMaterial = Promise.resolve();
  let payloadMode = "note";
  let selectedFile = null;
  let sealedFile = null;
  let fileMeta = null;
  let fileCredentials = null;
  let savedDownload = null;
  let createPhase = null;
  const cryptoAvailable = !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues);
  const downloadAnchor = document.createElement("a");
  downloadAnchor.hidden = true;
  document.body.appendChild(downloadAnchor);

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
    $("note-field").hidden = payloadMode === "file";
    $("file-field").hidden = payloadMode !== "file";
    $("file-size").textContent = selectedFile ? `${selectedFile.size.toLocaleString(language)} ${text("bytes")}` : "";
    if (fileMeta) {
      const safeName = sanitizeFileName(fileMeta.name);
      const fileLabel = `${safeName} · ${fileMeta.size.toLocaleString(language)} ${text("bytes")}`;
      $("file-summary").hidden = false;
      $("file-summary").textContent = fileLabel;
      $("file-download-status").textContent = fileLabel;
      document.querySelector('[data-i18n="warningTitle"]').textContent = text("fileWarningTitle");
      document.querySelector('[data-i18n="warningBody"]').textContent = text("fileWarningBody");
    } else {
      $("file-summary").hidden = true;
      $("file-summary").textContent = "";
      $("file-download-status").textContent = "";
    }
    const createLabel = !createBusy ? "createButton" : payloadMode === "file" ? (createPhase === "uploading" ? "uploading" : "encrypting") : "creating";
    let readLabel = "readButton";
    if (readBusy) readLabel = "opening";
    else if (fileMeta) readLabel = "fileReadButton";
    else if (sealedFile && fragment && fragment.version === "v1p") readLabel = "continueButton";
    $("create-button").firstElementChild.textContent = text(createLabel);
    $("read-button").firstElementChild.textContent = text(readLabel);
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
  const shortAlphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  function shortCode() {
    const bytes = randomBytes(16);
    let code = "";
    for (let i = 0; i < bytes.length; i++) code += shortAlphabet[bytes[i] & 31];
    return code;
  }
  function isShortCode(value) { return /^[0-9a-hjkmnp-tv-z]{16}$/.test(value); }
  async function passwordPackage(key, token, password) {
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const pair = new Uint8Array(64);
    pair.set(key);
    pair.set(token, 32);
    const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await passwordKey(password, salt), pair));
    const pack = new Uint8Array(108);
    pack.set(salt);
    pack.set(nonce, 16);
    pack.set(wrapped, 28);
    return pack;
  }
  async function sealKey(code, usage) {
    return crypto.subtle.importKey("raw", encoder.encode(code), "HKDF", false, ["deriveKey"]).then((material) => crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: usage.salt, info: encoder.encode("s4cred-short-link-v1") },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      [usage.op]
    ));
  }
  async function sealPackage(code, plaintext) {
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await sealKey(code, { salt, op: "encrypt" }), plaintext));
    const flags = plaintext.length === 108 ? 1 : 0;
    if (plaintext.length !== 64 && plaintext.length !== 108) throw new Error("Invalid package");
    const blob = new Uint8Array(30 + sealed.length);
    blob[0] = 2;
    blob[1] = flags;
    blob.set(salt, 2);
    blob.set(nonce, 18);
    blob.set(sealed, 30);
    return blob;
  }
  async function unsealPackage(code, blob) {
    if (blob.length !== 110 && blob.length !== 154 || blob[0] !== 2 || blob[1] !== 0 && blob[1] !== 1 || (blob[1] === 0 ? 110 : 154) !== blob.length) throw new Error("Invalid seal");
    const salt = blob.slice(2, 18);
    const nonce = blob.slice(18, 30);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await sealKey(code, { salt, op: "decrypt" }), blob.slice(30)));
    if (blob[1] === 0) {
      if (plain.length !== 64) throw new Error("Invalid package");
      return { version: "v1", key: plain.slice(0, 32), token: plain.slice(32) };
    }
    if (plain.length !== 108) throw new Error("Invalid package");
    return { version: "v1p", salt: plain.slice(0, 16), nonce: plain.slice(16, 28), wrapped: plain.slice(28) };
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
  const apiErrors = { invalid_note: "invalidNote", not_found: "notFound", capacity_exceeded: "capacity", origin_forbidden: "origin", too_large: "tooLarge", internal_error: "internal" };
  async function readAPI(response) {
    let data;
    try { data = await response.json(); } catch (_) { throw new Error("network"); }
    if (!response.ok) {
      const error = new Error("api");
      error.messageKey = apiErrors[data && data.error] || "internal";
      throw error;
    }
    return data;
  }
  async function request(path, body) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", redirect: "error" });
    return readAPI(response);
  }
  function sameBytes(left, right) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
  }
  function endOfJSONValue(source, start) {
    const first = source[start];
    if (first === '"') {
      let index = start + 1;
      while (index < source.length) {
        if (source[index] === "\\") { index += 2; continue; }
        if (source[index] === '"') return index + 1;
        index++;
      }
      throw new Error("metadata");
    }
    if (first === "{" || first === "[") {
      let depth = 0;
      let inString = false;
      for (let index = start; index < source.length; index++) {
        const current = source[index];
        if (inString) {
          if (current === "\\") { index++; continue; }
          if (current === '"') inString = false;
          continue;
        }
        if (current === '"') { inString = true; continue; }
        if (current === "{" || current === "[") depth++;
        else if (current === "}" || current === "]") {
          depth--;
          if (depth === 0) return index + 1;
        }
      }
      throw new Error("metadata");
    }
    const match = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(source.slice(start));
    if (!match) throw new Error("metadata");
    return start + match[0].length;
  }
  // JSON.parse collapses duplicate keys before a reviver runs, so scan the object instead.
  function parseFileMetadata(bytes) {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let index = 0;
    const skip = () => { while (index < source.length && " \t\n\r".includes(source[index])) index++; };
    const fail = () => { throw new Error("metadata"); };
    skip();
    if (source[index] !== "{") fail();
    index++;
    const fields = new Map();
    skip();
    if (source[index] !== "}") {
      for (;;) {
        skip();
        if (source[index] !== '"') fail();
        const keyStart = index;
        index++;
        while (index < source.length) {
          if (source[index] === "\\") { index += 2; continue; }
          if (source[index] === '"') { index++; break; }
          index++;
        }
        if (source[index - 1] !== '"') fail();
        const key = JSON.parse(source.slice(keyStart, index));
        if (typeof key !== "string" || fields.has(key)) fail();
        skip();
        if (source[index] !== ":") fail();
        index++;
        skip();
        const valueEnd = endOfJSONValue(source, index);
        const value = JSON.parse(source.slice(index, valueEnd));
        index = valueEnd;
        fields.set(key, value);
        skip();
        if (source[index] === ",") { index++; continue; }
        if (source[index] === "}") { index++; break; }
        fail();
      }
    } else index++;
    skip();
    if (index !== source.length) fail();
    if (fields.size !== 3 || !fields.has("name") || !fields.has("type") || !fields.has("size")) fail();
    const name = fields.get("name");
    const type = fields.get("type");
    const size = fields.get("size");
    if (typeof name !== "string" || typeof type !== "string") fail();
    const nameLength = encoder.encode(name).length;
    if (nameLength < 1 || nameLength > 255 || encoder.encode(type).length > 255) fail();
    if (!Number.isInteger(size) || size < 1 || size > fileLimit) fail();
    return { name, type, size };
  }
  function sanitizeFileName(name) {
    const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
    let base = slash >= 0 ? name.slice(slash + 1) : name;
    base = base.replace(/[\u0000-\u001F\u007F\p{Cf}]/gu, "");
    base = base.replace(/^[\s.]+|[\s.]+$/g, "");
    if (!base) base = "s4cred-file";
    const bytes = encoder.encode(base);
    if (bytes.length <= 200) return base;
    let end = 200;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
  }
  async function decryptFileMeta(key, ciphertext, nonce) {
    const metaCipher = decode64(ciphertext);
    const metaNonce = decode64(nonce, 12);
    if (metaCipher.length < 17 || metaCipher.length > 4112) throw new Error("metadata");
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: metaNonce, additionalData: metaAAD }, await aesKey(key, "decrypt"), metaCipher));
    return parseFileMetadata(plain);
  }
  async function openFilePayload(key, buffer) {
    if (buffer.length < 4) throw new Error("payload");
    const headerLen = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(0);
    if (headerLen < 1 || headerLen > 8192 || buffer.length < 4 + headerLen) throw new Error("payload");
    const head = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(4, 4 + headerLen)));
    const tail = buffer.subarray(4 + headerLen);
    const metaCipher = decode64(head.ciphertext);
    const metaNonce = decode64(head.nonce, 12);
    const fileNonce = decode64(head.file_nonce, 12);
    if (!Number.isInteger(head.file_size) || head.file_size !== tail.length || metaCipher.length < 17 || metaCipher.length > 4112) throw new Error("payload");
    const aes = await aesKey(key, "decrypt");
    const metaPlain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: metaNonce, additionalData: metaAAD }, aes, metaCipher));
    const meta = parseFileMetadata(metaPlain);
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fileNonce, additionalData: fileAAD }, aes, tail));
    if (plaintext.length !== meta.size) throw new Error("payload");
    return { meta, plaintext };
  }
  function clickDownload(url, name) {
    downloadAnchor.href = url;
    downloadAnchor.download = name;
    downloadAnchor.click();
  }
  function clearDownload() {
    if (savedDownload) URL.revokeObjectURL(savedDownload.url);
    savedDownload = null;
    downloadAnchor.removeAttribute("href");
    downloadAnchor.download = "";
  }
  function setBusy(which, busy) {
    if (which === "create") createBusy = busy;
    else readBusy = busy;
    $(`${which}-button`).disabled = busy || !cryptoAvailable || (which === "read" && (!fragment || !noteID));
    render();
  }
  function refreshReadLink(changed) {
    const revision = ++readRevision;
    readLocation = location.href;
    fragment = null;
    noteID = null;
    sealedFile = null;
    fileMeta = null;
    fileCredentials = null;
    clearDownload();
    $("read-password").value = "";
    $("read-password-field").hidden = true;
    $("opened-note").textContent = "";
    $("opened").hidden = true;
    $("opened-file").hidden = true;
    $("file-download-status").textContent = "";
    $("read-confirm").hidden = false;
    setMessage($("note-copy-status"), null);
    setMessage($("read-error"), null);
    if (changed) setMessage($("read-interrupted"), readUncertain ? "readChangedAfterRequest" : "linkChanged");
    $("read-button").disabled = readBusy || !cryptoAvailable;
    const job = loadReadLink(revision);
    pendingMaterial = job;
    render();
    return job;
  }
  async function loadReadLink(revision) {
    try {
      const match = /^\/n\/([A-Za-z0-9_-]+)$/.exec(location.pathname);
      if (!match) throw new Error("Invalid path");
      const hash = location.hash.slice(1);
      if (hash) {
        decode64(match[1], 32);
        const parsed = parseFragment(hash);
        if (revision !== readRevision) return;
        noteID = match[1];
        fragment = parsed;
        $("read-password-field").hidden = fragment.version !== "v1p";
        return;
      }
      const code = match[1].toLowerCase();
      if (!isShortCode(code)) throw new Error("Invalid path");
      const data = await request(`/api/notes/${code}/material`, {});
      if (revision !== readRevision) return;
      const parsed = await unsealPackage(code, decode64(data.link_secret));
      if (revision !== readRevision) return;
      let nextFile = null;
      let nextMeta = null;
      if (data.file != null) {
        if (typeof data.file.ciphertext !== "string" || typeof data.file.nonce !== "string") throw new Error("Invalid material");
        nextFile = { ciphertext: data.file.ciphertext, nonce: data.file.nonce };
        if (parsed.version !== "v1p") nextMeta = await decryptFileMeta(parsed.key, nextFile.ciphertext, nextFile.nonce);
      }
      if (revision !== readRevision) return;
      noteID = code;
      fragment = parsed;
      sealedFile = nextFile;
      fileMeta = nextMeta;
      $("read-password-field").hidden = fragment.version !== "v1p";
    } catch (error) {
      if (revision !== readRevision) return;
      fragment = null;
      noteID = null;
      sealedFile = null;
      fileMeta = null;
      fileCredentials = null;
      if (error.messageKey) setMessage($("read-error"), error.messageKey);
      else if (error.message === "network") setMessage($("read-error"), "materialNetwork");
      else setMessage($("read-error"), "invalidLink");
    } finally {
      if (revision === readRevision) {
        $("read-button").disabled = readBusy || !fragment || !noteID || !cryptoAvailable;
        render();
      }
    }
  }

  $("language").addEventListener("change", (event) => { language = event.target.value; savePreference("s4cred-language", language); render(); });
  $("theme").addEventListener("click", () => { theme = theme === "dark" ? "light" : "dark"; savePreference("s4cred-theme", theme); render(); });
  $("note").addEventListener("input", updateCount);
  for (const radio of document.querySelectorAll('input[name="payload"]')) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      payloadMode = radio.value === "file" ? "file" : "note";
      render();
    });
  }
  $("file").addEventListener("change", () => {
    selectedFile = $("file").files && $("file").files.length ? $("file").files[0] : null;
    render();
  });
  $("download-file").addEventListener("click", () => {
    if (!savedDownload) return;
    clickDownload(savedDownload.url, savedDownload.name);
  });
  $("protect").addEventListener("change", () => {
    $("password-fields").hidden = !$("protect").checked;
    if (!$("protect").checked) { $("create-password").value = ""; $("confirm-password").value = ""; }
  });
  $("create-another").addEventListener("click", () => { $("link").value = ""; $("created").hidden = true; $("create-form").hidden = false; setMessage($("link-copy-status"), null); $("note").focus(); });

  async function createFile() {
    if (createBusy) return;
    setMessage($("create-error"), null);
    const file = selectedFile;
    if (!file) return setMessage($("create-error"), "fileEmpty");
    if (file.size < 1 || file.size > fileLimit) return setMessage($("create-error"), "fileTooLarge");
    const nameLength = encoder.encode(file.name).length;
    if (nameLength < 1 || nameLength > 255) return setMessage($("create-error"), "fileNameTooLong");
    const protectedLink = $("protect").checked;
    const password = protectedLink ? $("create-password").value : null;
    if (protectedLink && !password) return setMessage($("create-error"), "passwordRequired");
    if (protectedLink && password.normalize("NFC") !== $("confirm-password").value.normalize("NFC")) return setMessage($("create-error"), "passwordMismatch");
    if (!["3600", "86400", "604800"].includes($("ttl").value)) return setMessage($("create-error"), "invalidNote");
    createPhase = "encrypting";
    setBusy("create", true);
    let requestStarted = false;
    try {
      const type = encoder.encode(file.type || "").length > 255 ? "" : (file.type || "");
      const metadata = encoder.encode(JSON.stringify({ name: file.name, type, size: file.size }));
      const key = randomBytes(32), token = randomBytes(32), nonce = randomBytes(12);
      let fileNonce = randomBytes(12);
      if (sameBytes(nonce, fileNonce)) fileNonce = randomBytes(12);
      const aes = await aesKey(key, "encrypt");
      const metaCipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: metaAAD }, aes, metadata));
      if (metaCipher.length < 17 || metaCipher.length > 4112) {
        const error = new Error("metadata");
        error.messageKey = "invalidNote";
        throw error;
      }
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const fileCipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: fileNonce, additionalData: fileAAD }, aes, fileBytes));
      const tokenHash = new Uint8Array(await crypto.subtle.digest("SHA-256", token));
      const code = shortCode();
      const pair = new Uint8Array(64);
      pair.set(key);
      pair.set(token, 32);
      const linkSecret = await sealPackage(code, password === null ? pair : await passwordPackage(key, token, password));
      const idHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(code)));
      const headerBytes = encoder.encode(JSON.stringify({
        ciphertext: encode64(metaCipher),
        nonce: encode64(nonce),
        file_nonce: encode64(fileNonce),
        file_size: fileCipher.length,
        ttl: Number($("ttl").value),
        read_token_hash: encode64(tokenHash),
        id_hash: encode64(idHash),
        link_secret: encode64(linkSecret)
      }));
      const body = new Uint8Array(4 + headerBytes.length + fileCipher.length);
      new DataView(body.buffer).setUint32(0, headerBytes.length);
      body.set(headerBytes, 4);
      body.set(fileCipher, 4 + headerBytes.length);
      createPhase = "uploading";
      render();
      requestStarted = true;
      const response = await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/vnd.s4cred.upload" }, body, cache: "no-store", redirect: "error" });
      const result = await readAPI(response);
      if (result.ok !== true) throw new Error("api");
      $("link").value = `${location.origin}/n/${code}`;
      $("share-password").hidden = !protectedLink;
      $("note").value = "";
      $("file").value = "";
      selectedFile = null;
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
    } finally {
      createPhase = null;
      setBusy("create", false);
    }
  }

  $("create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (createBusy) return;
    if (payloadMode === "file") return createFile();
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
      const code = shortCode();
      const pair = new Uint8Array(64);
      pair.set(key);
      pair.set(token, 32);
      const linkSecret = await sealPackage(code, password === null ? pair : await passwordPackage(key, token, password));
      const idHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(code)));
      requestStarted = true;
      const result = await request("/api/notes", { ciphertext: encode64(ciphertext), nonce: encode64(nonce), ttl: Number($("ttl").value), read_token_hash: encode64(tokenHash), id_hash: encode64(idHash), link_secret: encode64(linkSecret) });
      if (result.ok !== true) throw new Error("api");
      $("link").value = `${location.origin}/n/${code}`;
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
    if (readBusy) return;
    setBusy("read", true);
    try {
      if (readLocation !== location.href) await refreshReadLink(true);
      if (pendingMaterial) await pendingMaterial;
    } finally {
      if (!readAttempt) setBusy("read", false);
    }
    if (readBusy || readLocation !== location.href || !fragment || !noteID) return;
    setMessage($("read-error"), null);
    if (fragment.version === "v1p" && !fileCredentials && !$("read-password").value) return setMessage($("read-error"), "passwordRequired");
    const attempt = { href: location.href, revision: readRevision, fragment, noteID, file: sealedFile, sent: false };
    const password = $("read-password").value;
    const current = () => attempt.href === location.href && attempt.revision === readRevision;
    readAttempt = attempt;
    setBusy("read", true);
    try {
      let credentials;
      if (fileCredentials && attempt.file) credentials = fileCredentials;
      else if (attempt.fragment.version === "v1p") {
        try { credentials = await unwrapFragment(password, attempt.fragment); }
        catch (_) { if (current()) setMessage($("read-error"), "wrongPassword"); return; }
        if (!current()) return;
        if (attempt.file) {
          try {
            const meta = await decryptFileMeta(credentials.key, attempt.file.ciphertext, attempt.file.nonce);
            if (!current()) return;
            fileMeta = meta;
            fileCredentials = credentials;
          } catch (_) { if (current()) setMessage($("read-error"), "invalidLink"); }
          return;
        }
      } else credentials = attempt.fragment;
      if (!current()) return;
      if (attempt.file) {
        attempt.sent = true;
        let response;
        try {
          response = await fetch(`/api/notes/${attempt.noteID}/consume`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ read_token: encode64(credentials.token), accept_file: true }),
            cache: "no-store",
            redirect: "error"
          });
        } catch (_) { if (current()) setMessage($("read-error"), "readNetwork"); return; }
        if (!current()) return;
        if (!response.ok) {
          let data;
          try { data = await response.json(); } catch (_) { if (current()) setMessage($("read-error"), "readNetwork"); return; }
          if (current()) setMessage($("read-error"), apiErrors[data && data.error] || "internal");
          return;
        }
        try {
          const contentType = (response.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
          if (contentType !== "application/vnd.s4cred.payload") throw new Error("payload");
          const delivered = await openFilePayload(credentials.key, new Uint8Array(await response.arrayBuffer()));
          if (!current()) return;
          const name = sanitizeFileName(delivered.meta.name);
          const url = URL.createObjectURL(new Blob([delivered.plaintext], { type: "application/octet-stream" }));
          clearDownload();
          savedDownload = { url, name };
          clickDownload(url, name);
          $("read-password").value = "";
          $("read-confirm").hidden = true;
          $("opened").hidden = true;
          $("opened-file").hidden = false;
          $("download-file").focus();
        } catch (_) { if (current()) setMessage($("read-error"), "decryptError"); }
        return;
      }
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
        $("opened-file").hidden = true;
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
