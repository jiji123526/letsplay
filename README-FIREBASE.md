# Firebase setup

Your iMessage UI is now wired to **Firebase (Firestore + Anonymous Auth)** for
realtime, multi-user, persistent chat. Follow these steps once.

## 1. Create the project
1. Go to <https://console.firebase.google.com/> → **Add project**.
2. Inside the project, click the **Web** icon (`</>`) to register a web app.
3. Copy the generated `firebaseConfig` object.

## 2. Paste your keys
Open `firebase-config.js` and replace the placeholder values with your config.
Also set `ADMIN_PASSCODE` to whatever you want the admin password to be.

> The web API key is **not a secret** — it's meant to ship to the browser.
> Access is controlled by the security rules below, not by hiding the key.

## 3. Enable Anonymous Auth
Console → **Build → Authentication → Get started → Sign-in method** →
enable **Anonymous**.

## 4. Create Firestore
Console → **Build → Firestore Database → Create database** →
start in **Production mode** → pick a region.

## 5. Paste the security rules
Console → **Firestore → Rules** tab → replace everything with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /messages/{id} {
      // anyone signed in (incl. anonymous) can read the chat
      allow read: if request.auth != null;

      // you may only create a message stamped with YOUR OWN uid,
      // it must have text (<= 2000 chars) and a server timestamp
      allow create: if request.auth != null
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.text is string
        && request.resource.data.text.size() > 0
        && request.resource.data.text.size() <= 2000
        && request.resource.data.createdAt == request.time;

      // deletes: the author can delete their own message.
      // (Admin delete from the client works only for messages the admin
      //  authored. For true cross-user moderation, use a Cloud Function
      //  or the "admins" allowlist below.)
      allow delete: if request.auth != null
        && resource.data.uid == request.auth.uid;

      allow update: if false;
    }
  }
}
```

Click **Publish**.

## 6. Run it
Serve the folder over http (the app uses ES modules, so `file://` won't work):

```
cd imessage
python3 -m http.server 3000
```

Open the URL, enter a nickname, and chat. Open a second browser/incognito
window and messages appear live in both.

---

## Notes & next steps

- **Your own messages** render as blue `sent` bubbles; everyone else's are gray
  `recv` bubbles with the sender's nickname above the group. Date separators are
  computed from real timestamps (Today / Yesterday / weekday).
- **Admin mode**: check "관리자 모드" on the entry screen and enter the passcode.
  Admins see a delete affordance (tap a bubble to delete). Note the rule caveat
  above — client-side admin delete only removes the admin's *own* messages
  unless you add server-side moderation.

### To give admins real cross-user delete power
Add an `admins/{uid}` collection (one doc per admin uid) and change the delete
rule to:

```
allow delete: if request.auth != null
  && (resource.data.uid == request.auth.uid
      || exists(/databases/$(database)/documents/admins/$(request.auth.uid)));
```

Then create a doc in `admins` whose ID is the admin's anonymous uid
(printed in the browser console on load, or add a small "copy my uid" button).

### Features from the original still to add (optional)
- Threaded replies (`reply_to`) — add a "replying to…" bar above the composer.
- Link/media embeds (YouTube / X / Instagram) — detect URLs in `text` and
  render an embed inside the bubble.
- Ban list (`banned/{uid}`) enforced in the read/create rules.
- The `/sort` fancam voting page — a separate self-contained page.
