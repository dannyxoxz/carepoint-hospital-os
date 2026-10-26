# CarePoint Hospital OS

CarePoint is a React + Vite frontend with a Node.js + Express API and MongoDB. It includes a public recruitment form, owner-controlled administrator management, doctor specialty profiles, and the existing hospital workflow modules.

## 1. Security first

- The distributable ZIP deliberately excludes `.env`, `node_modules`, and built `dist` files.
- The uploaded project contained a database URI and secrets in its `.env` file. Treat those values as exposed: rotate the MongoDB database user's password and JWT secret before running this project. Do not reuse the leaked values.
- Patient email addresses are legitimate patient-record fields and are not deleted. This update changes CarePoint's administrative/contact inbox to `setemiadelokun11@gmail.com`; it does not delete patient records or historical data.
- Only `setemiadelokun11@gmail.com` is the primary owner administrator. Additional admin accounts can be created by the owner from **Users & Permissions**. Existing non-owner admins can be demoted to staff with the explicit `npm run secure:owner` migration after verifying the owner account exists.
- The owner bootstrap account must use a strong unique password. Do not share it.

## 2. Configure the backend

Open a terminal in the project folder:

```bash
cd backend
npm install
```

Copy `.env.example` to `.env` (on Windows PowerShell: `Copy-Item .env.example .env`; on Git Bash: `cp .env.example .env`). Fill in your own MongoDB connection URI and a random `JWT_SECRET` with at least 32 characters. Encode special characters in the MongoDB password for a URI.

To create/update the primary owner login, set `NEW_USER_ROLE=admin`, `NEW_USER_EMAIL=setemiadelokun11@gmail.com`, a name and a strong unique `NEW_USER_PASSWORD` in `.env`, then run:

```bash
npm run user:create
npm run secure:owner
npm run seed
npm run test:syntax
npm run dev
```

`secure:owner` requires the primary owner account to exist and be active first. It demotes other existing admin-role accounts to staff; it does not delete users, patient records, or emails. The owner can then create trusted additional admins in the UI.

## 3. Configure job-application email

The public recruitment form is available at `http://localhost:5173/careers`. Applicants submit their name, email, phone number, desired position, qualifications, optional cover letter, and one PDF CV (up to 5 MB). The backend validates the PDF signature and sends it as an email attachment to `JOB_APPLICATION_EMAIL`, defaulting to the owner inbox. Uploaded CVs are not saved as public files or stored in MongoDB.

For email delivery, fill these settings in `backend/.env` using Gmail SMTP or your email provider's settings:

- `SMTP_HOST`
- `SMTP_PORT` (usually 587)
- `SMTP_SECURE` (`false` for STARTTLS on port 587; use `true` only when your provider specifies implicit TLS)
- `SMTP_USER`
- `SMTP_PASS` (prefer an app password or provider credential, never your ordinary account password)
- `SMTP_FROM` (a sender address authorized by the provider)
- `JOB_APPLICATION_EMAIL=setemiadelokun11@gmail.com`
- `CAREPOINT_WHATSAPP=09169160764`

The form returns an explicit configuration error if SMTP is not set up; it does not pretend the email was sent. Do not paste credentials into chat or commit `.env` to source control. For production, add malware scanning for attachments, TLS, spam protection, privacy notice/retention rules, and verify the mail provider's attachment-size limits.

## 4. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run build
npm run dev
```

Open the local URL Vite prints. The public application page is `/careers`; the staff application is the normal sign-in page.

## 5. Current scope and honest limitations

The public careers workflow and owner administrator APIs are implemented in this version, and the admin management screen is available to the owner. The project also contains existing hospital APIs and navigation for clinical and operational modules. Some specialist modules remain development outlines rather than complete clinical-grade workflows. A frontend production build and live MongoDB/SMTP delivery test could not be completed in this environment because dependency installation was unavailable/incomplete. Test with fictional data and a test mailbox before production; obtain clinical, privacy, and security review before using real patient data.
