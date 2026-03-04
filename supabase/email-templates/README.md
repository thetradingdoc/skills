# Supabase Email Templates — BB-8 Header

Add the BB-8 artwork to your Supabase Auth email templates (Confirm signup, Magic link, Reset password, etc.).

## How to add the BB-8 snippet

1. Open your [Supabase Dashboard](https://supabase.com/dashboard) → **Authentication** → **Email Templates**.
2. For **each** template you want to customize:
   - **Confirm signup**
   - **Magic link**
   - **Reset password**
   - **Invite user**
   - **Change email address**
   - **Reauthentication**
3. Open `bb8-snippet.html` in this folder.
4. Copy the entire contents (or everything inside the `<section>...</section>` tags).
5. Paste the snippet at the **top** of the template body, before the heading (e.g. "Confirm your signup", "Reset Password", etc.).
6. Save the template.

## Example: Reset Password template

Before:

```html
<h2>Reset Password</h2>
<p>Follow this link to reset the password for your user:</p>
<p><a href="{{ .ConfirmationURL }}">Reset Password</a></p>
```

After (with BB-8 at top):

```html
<!-- Paste contents of bb8-snippet.html here -->
<section style="text-align: center; margin-bottom: 16px;">
  <svg xmlns="http://www.w3.org/2000/svg" ...>
    ...
  </svg>
</section>

<h2>Reset Password</h2>
<p>Follow this link to reset the password for your user:</p>
<p><a href="{{ .ConfirmationURL }}">Reset Password</a></p>
```

## Notes

- **No JavaScript in email** — The original BB-8 design used TweenMax/GSAP for animation. Email clients block JavaScript, so the snippet is **static**.
- **Inline SVG support** — Many clients (Gmail, Apple Mail, web clients) support inline SVG. Outlook often strips or breaks it. Test in your target clients.
- **PNG fallback** — For the best compatibility (especially Outlook), export the BB-8 SVG as PNG (e.g. 300×300px), host it (Supabase Storage, Cloudflare R2, etc.), and replace the SVG block with:

  ```html
  <img src="https://your-cdn.com/bb8.png" alt="BB-8" style="width: 200px; max-width: 100%; height: auto; display: block; margin: 0 auto 16px;" />
  ```

- **Free plan** — Supabase free tier doesn’t support shared/partial templates, so paste the same snippet into each template manually.
