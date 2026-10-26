import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../models.js';
const role = String(process.env.NEW_USER_ROLE || '').toLowerCase();
const name = String(process.env.NEW_USER_NAME || '').trim();
const email = String(process.env.NEW_USER_EMAIL || '').trim().toLowerCase();
const password = String(process.env.NEW_USER_PASSWORD || '');
const ownerEmail = String(process.env.OWNER_ADMIN_EMAIL || 'setemiadelokun11@gmail.com').trim().toLowerCase();
if (!['admin','doctor','staff'].includes(role) || !name || !email || password.length < 12 || (role === 'admin' && email !== ownerEmail)) { console.error('Set NEW_USER_ROLE (doctor/staff, or admin only for OWNER_ADMIN_EMAIL), NEW_USER_NAME, NEW_USER_EMAIL and NEW_USER_PASSWORD (12+ chars) in backend/.env. Additional admins must be created by the owner inside Users & Permissions.'); process.exit(1); }
try { await mongoose.connect(process.env.MONGODB_URI); const passwordHash = await bcrypt.hash(password, 12); await User.findOneAndUpdate({ email }, { $set: { name, email, passwordHash, role, active: true } }, { upsert: true, new: true, runValidators: true }); console.log(`Created/updated ${role} account: ${email}`); } catch(e) { console.error('Could not create account:', e.message); process.exitCode = 1; } finally { await mongoose.disconnect().catch(()=>{}); }
