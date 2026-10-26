import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { Patient, User, Appointment, Department, ClinicalRecord, LabOrder, Medicine, InventoryTransaction, Invoice, Payment, Ward, Admission, RadiologyOrder, Notification, AuditLog, StaffSchedule, DoctorProfile } from './models.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';

const app = express();
const port = Number(process.env.PORT) || 5000;
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: clientUrl.split(',').map(value => value.trim()), credentials: true }));
app.use(express.json({ limit: '8mb' }));
app.use(morgan('dev'));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));

app.get('/', (_req, res) => res.json({ success: true, message: 'CarePoint Hospital API is running.' }));
app.get('/api/health', (_req, res) => res.json({ success: true, data: { api: 'online', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' } }));

app.post('/api/auth/register', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ success: false, message: 'Database is not connected. Check backend/.env and Atlas Network Access.' });
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name.length < 2 || name.length > 120) return res.status(400).json({ success: false, message: 'Enter your full name (2–120 characters).' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ success: false, message: 'Password must be between 8 and 128 characters.' });
    const existing = await User.findOne({ email }).lean();
    if (existing) return res.status(409).json({ success: false, message: 'An account with this email already exists. Please sign in.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, passwordHash, role: 'patient' });
    return res.status(201).json({ success: true, message: 'Account created successfully.', data: { user: { id: user._id, name: user.name, email: user.email, role: user.role } } });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ success: false, message: 'Database is not connected. Check backend/.env and Atlas Network Access.' });
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const requestedRole = String(req.body.role || 'patient').toLowerCase();
    if (!['patient', 'doctor', 'staff', 'admin'].includes(requestedRole)) return res.status(400).json({ success: false, message: 'Choose a valid account type.' });
    if (!email || !password) return res.status(400).json({ success: false, message: 'Enter your email address and password.' });
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ success: false, message: 'Email or password is incorrect.' });
    if (user.active === false) return res.status(403).json({ success: false, message: 'This account is inactive. Contact the hospital administrator.' });
    if (user.role !== requestedRole) {
      return res.status(403).json({ success: false, message: `This account is registered as ${user.role}. Select the matching account type.`, code: 'ROLE_MISMATCH', accountRole: user.role });
    }
    // Older or manually-created records may not contain passwordHash. Never pass
    // an undefined value to bcrypt.compare, which causes a 500 response.
    const storedHash = typeof user.passwordHash === 'string' ? user.passwordHash : '';
    if (!storedHash) {
      return res.status(401).json({ success: false, message: 'This account has no valid password hash. An administrator must reset/recreate the account using the backend user:create command.' });
    }
    const passwordMatches = await bcrypt.compare(password, storedHash).catch(() => false);
    if (!passwordMatches) {
      return res.status(401).json({ success: false, message: 'Credentials do not match the selected account type.' });
    }
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('CHANGE_THIS')) return res.status(503).json({ success: false, message: 'Authentication is not configured yet. Set a private JWT_SECRET of at least 32 characters in backend/.env.' });
    const token = jwt.sign({ sub: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
    return res.json({ success: true, data: { token, user: { id: user._id, name: user.name, email: user.email, role: user.role } } });
  } catch (error) { next(error); }
});


function authenticate(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) return res.status(401).json({ success: false, message: 'Authentication required.' });
  try { req.auth = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' }); }
}
function allowRoles(...roles) { return (req, res, next) => roles.includes(req.auth?.role) ? next() : res.status(403).json({ success: false, message: 'Your account does not have permission for this action.' }); }
const OWNER_EMAIL = String(process.env.OWNER_ADMIN_EMAIL || 'setemiadelokun11@gmail.com').trim().toLowerCase();
function ownerOnly(req, res, next) { User.findById(req.auth?.sub).select('email role active').then(user => { if (!user || user.active === false || user.role !== 'admin' || user.email.toLowerCase() !== OWNER_EMAIL) return res.status(403).json({ success:false, message:'Only the CarePoint owner administrator can manage administrator accounts.' }); next(); }).catch(next); }

// Public careers form: accepts a PDF CV only, emails it to the configured owner inbox, and does not keep the uploaded document in the database.
app.post('/api/careers/apply', rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false }), async (req,res,next) => {
  try {
    const name = cleanString(req.body.name,120); const email = cleanString(req.body.email,254).toLowerCase(); const phone = cleanString(req.body.phone,40); const position = cleanString(req.body.position,120); const qualifications = cleanString(req.body.qualifications,3000); const coverLetter = cleanString(req.body.coverLetter,5000); const cvBase64 = String(req.body.cvBase64 || ''); const cvName = cleanString(req.body.cvName || 'applicant-cv.pdf',120);
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !position || qualifications.length < 10) return res.status(400).json({success:false,message:'Enter your name, valid email, position and qualifications.'});
    if (!/^\+?[0-9 ()-]{7,25}$/.test(phone)) return res.status(400).json({success:false,message:'Enter a valid phone number.'});
    if (!cvBase64) return res.status(400).json({success:false,message:'Attach your CV as a PDF file.'});
    const raw = cvBase64.replace(/^data:application\/pdf;base64,/i,'');
    if (!/^[A-Za-z0-9+/=]+$/.test(raw) || raw.length > 7 * 1024 * 1024) return res.status(400).json({success:false,message:'CV must be a PDF no larger than 5 MB.'});
    const cvBuffer = Buffer.from(raw,'base64');
    if (cvBuffer.length > 5 * 1024 * 1024 || cvBuffer.subarray(0,5).toString() !== '%PDF-') return res.status(400).json({success:false,message:'The uploaded file is not a valid PDF or exceeds 5 MB.'});
    const inbox = String(process.env.JOB_APPLICATION_EMAIL || OWNER_EMAIL).trim().toLowerCase();
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.SMTP_FROM) return res.status(503).json({success:false,message:'Job application email is not configured yet. The administrator must set SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM in backend/.env.'});
    const transporter = nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE||'false')==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
    await transporter.sendMail({from:process.env.SMTP_FROM,to:inbox,replyTo:email,subject:`CarePoint job application: ${position} — ${name}`,text:`New CarePoint job application\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nPosition: ${position}\nQualifications: ${qualifications}\n\nCover letter:\n${coverLetter || 'Not provided'}\n\nWhatsApp contact listed by CarePoint: ${process.env.CAREPOINT_WHATSAPP || '09169160764'}`,attachments:[{filename:cvName.toLowerCase().endsWith('.pdf')?cvName:'applicant-cv.pdf',content:cvBuffer,contentType:'application/pdf'}]});
    return res.status(201).json({success:true,message:'Application submitted. Your CV has been sent to the CarePoint recruitment inbox.'});
  } catch(error) { next(error); }
});

// Owner-only administrator management. Additional admin accounts are created through this route, never public registration.
app.get('/api/owner/admins', authenticate, ownerOnly, async (_req,res,next) => { try { const data = await User.find({role:'admin'}).select('name email active createdAt').sort({createdAt:1}).lean(); res.json({success:true,data,ownerEmail:OWNER_EMAIL}); } catch(e) { next(e); } });
app.post('/api/owner/admins', authenticate, ownerOnly, async (req,res,next) => { try { const name=cleanString(req.body.name,120); const email=cleanString(req.body.email,254).toLowerCase(); const password=String(req.body.password||''); if(name.length<2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<12 || password.length>128) return res.status(400).json({success:false,message:'Provide a name, valid email, and password of 12–128 characters.'}); if(email===OWNER_EMAIL) return res.status(409).json({success:false,message:'The owner email is reserved for the primary administrator.'}); if(await User.exists({email})) return res.status(409).json({success:false,message:'An account with this email already exists.'}); const passwordHash=await bcrypt.hash(password,12); const user=await User.create({name,email,passwordHash,role:'admin',active:true}); await recordAudit(req,'create','admin-user',user._id,email); res.status(201).json({success:true,data:{id:user._id,name:user.name,email:user.email,role:user.role,active:user.active}}); } catch(e) { next(e); } });
app.patch('/api/owner/admins/:id/active', authenticate, ownerOnly, async (req,res,next) => { try { if(!safeId(req.params.id)) return res.status(400).json({success:false,message:'Invalid administrator ID.'}); const user=await User.findOne({_id:req.params.id,role:'admin'}); if(!user) return res.status(404).json({success:false,message:'Administrator not found.'}); if(user.email.toLowerCase()===OWNER_EMAIL) return res.status(400).json({success:false,message:'The primary owner account cannot be deactivated here.'}); user.active=Boolean(req.body.active); await user.save(); await recordAudit(req,'update','admin-user',user._id,`active=${user.active}`); res.json({success:true,data:{id:user._id,name:user.name,email:user.email,active:user.active}}); } catch(e) { next(e); } });

app.get('/api/appointments', authenticate, allowRoles('doctor', 'admin', 'staff'), async (req, res, next) => { try { const data = await Appointment.find(req.auth.role === 'doctor' ? { doctorUser: req.auth.sub } : {}).sort({ date: 1 }).limit(100).lean(); res.json({ success: true, data }); } catch (e) { next(e); } });
app.post('/api/appointments', authenticate, allowRoles('admin', 'staff'), async (req, res, next) => { try { const { patientName, patientEmail, doctor, department, date, notes } = req.body; const appointmentDate = new Date(date); if (!patientName || !String(patientName).trim() || !doctor || !String(doctor).trim() || !date || Number.isNaN(appointmentDate.getTime())) return res.status(400).json({ success: false, message: 'Patient name, doctor and a valid appointment date/time are required.' }); if (appointmentDate < new Date()) return res.status(400).json({success:false,message:'Appointment date must be in the future.'}); const doctorName=String(doctor).trim(); const conflict=await Appointment.findOne({doctor:doctorName,status:{$nin:['Cancelled','Completed']},date:{$gte:new Date(appointmentDate.getTime()-30*60000),$lte:new Date(appointmentDate.getTime()+30*60000)}}).lean(); if(conflict) return res.status(409).json({success:false,message:'This doctor already has an appointment within 30 minutes of the selected time.'}); const data = await Appointment.create({ patientName: String(patientName).trim().slice(0,120), patientEmail: String(patientEmail || '').trim().toLowerCase().slice(0,254), doctor: doctorName.slice(0,120), department: String(department || 'General Medicine').trim().slice(0,100), date: appointmentDate, notes: String(notes || '').slice(0,1000), status: 'Scheduled' }); await recordAudit(req,'create','appointment',data._id,`${data.patientName} / ${data.doctor}`); res.status(201).json({ success: true, data, message: 'Appointment created.' }); } catch(e) { next(e); } });
app.patch('/api/appointments/:id/status', authenticate, allowRoles('admin','staff','doctor'), async (req,res,next) => { try { if(!safeId(req.params.id)) return res.status(400).json({success:false,message:'Invalid appointment ID.'}); const allowed=['Scheduled','Checked in','In consultation','Completed','Cancelled']; if(!allowed.includes(req.body.status)) return res.status(400).json({success:false,message:'Choose a valid appointment status.'}); const filter={_id:req.params.id}; if(req.auth.role==='doctor') filter.doctorUser=req.auth.sub; const data=await Appointment.findOneAndUpdate(filter,{$set:{status:req.body.status}},{new:true,runValidators:true}); if(!data) return res.status(404).json({success:false,message:'Appointment not found or not assigned to this doctor.'}); await recordAudit(req,'update','appointment',data._id,`status=${data.status}`); res.json({success:true,data,message:'Appointment status updated.'}); } catch(e) { next(e); } });

app.get('/api/patients', authenticate, allowRoles('admin', 'staff', 'doctor'), async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ success: false, message: 'Database is not connected. Check backend/.env and your Atlas network access.' });
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const search = String(req.query.search || '').trim();
    const filter = search ? { $or: [{ name: { $regex: search, $options: 'i' } }, { patientId: { $regex: search, $options: 'i' } }, { department: { $regex: search, $options: 'i' } }] } : {};
    const [data, total] = await Promise.all([Patient.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Patient.countDocuments(filter)]);
    return res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

app.post('/api/patients', authenticate, allowRoles('admin', 'staff'), async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ success: false, message: 'Database is not connected. Check backend/.env and your Atlas network access.' });
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'Patient name is required.' });
    if (name.length > 120) return res.status(400).json({ success: false, message: 'Patient name must be 120 characters or fewer.' });
    const patientId = `CP-${Date.now().toString().slice(-8)}`;
    const patient = await Patient.create({ patientId, name, email: String(req.body.email || '').trim(), department: String(req.body.department || 'General Medicine').trim(), doctor: String(req.body.doctor || '').trim(), status: req.body.status || 'Waiting' });
    return res.status(201).json({ success: true, data: patient, message: 'Patient registered successfully.' });
  } catch (error) { next(error); }
});




// Doctor directory: one secure doctor login can have one professional profile.
// Specialty is explicit; it is not inferred from the generic account role.
const doctorSpecialties = ['General Practitioner','Family Medicine','Internal Medicine','Cardiology','Neurology','Neurosurgery','Paediatrics','Obstetrics & Gynaecology','General Surgery','Orthopaedic Surgery','Plastic Surgery','Urology','Ophthalmology','Otolaryngology (ENT)','Dermatology','Psychiatry','Psychology','Radiology','Anaesthesiology','Emergency Medicine','Oncology','Pathology','Haematology','Endocrinology','Gastroenterology','Nephrology','Pulmonology','Infectious Diseases','Rheumatology','Dentistry','Oral & Maxillofacial Surgery','Physiotherapy','Other'];
app.get('/api/doctors', authenticate, allowRoles('admin','staff','doctor'), async (req,res,next) => {
  try {
    const filter = { active: true };
    if (req.query.specialty && doctorSpecialties.includes(String(req.query.specialty))) filter.specialty = String(req.query.specialty);
    if (req.auth.role === 'doctor') filter.userId = req.auth.sub;
    const data = await DoctorProfile.find(filter).populate('userId','name email role').sort({ specialty: 1, createdAt: -1 }).limit(300).lean();
    res.json({ success: true, data });
  } catch (e) { next(e); }
});
app.post('/api/doctors', authenticate, allowRoles('admin'), async (req,res,next) => {
  try {
    const email = cleanString(req.body.email,254).toLowerCase();
    const specialty = cleanString(req.body.specialty,100);
    const department = cleanString(req.body.department,100);
    if (!email || !doctorSpecialties.includes(specialty) || !department) return res.status(400).json({ success:false, message:'Enter an existing doctor account email, a valid specialty and a department.' });
    const user = await User.findOne({ email, role:'doctor' });
    if (!user) return res.status(404).json({ success:false, message:'No doctor login was found for this email. Create the doctor account first using the admin user:create command.' });
    const yearsExperience = Number(req.body.yearsExperience || 0), consultationFee = Number(req.body.consultationFee || 0);
    if (!Number.isInteger(yearsExperience) || yearsExperience < 0 || yearsExperience > 70 || !Number.isFinite(consultationFee) || consultationFee < 0) return res.status(400).json({ success:false, message:'Experience and consultation fee must be valid non-negative values.' });
    const data = await DoctorProfile.findOneAndUpdate({ userId:user._id }, { $set:{ specialty, subspecialty:cleanString(req.body.subspecialty,120), department, licenseNumber:cleanString(req.body.licenseNumber,100), qualifications:cleanString(req.body.qualifications,500), yearsExperience, consultationFee, availability:['Available','Busy','On leave','Off duty'].includes(req.body.availability) ? req.body.availability : 'Available', active:true } }, { new:true, upsert:true, runValidators:true, setDefaultsOnInsert:true }).populate('userId','name email role');
    await recordAudit(req,'upsert','doctor-profile',data._id,`${specialty} · ${department}`);
    res.status(201).json({ success:true, data, message:'Doctor specialty profile saved.' });
  } catch (e) { next(e); }
});
app.patch('/api/doctors/:id', authenticate, allowRoles('admin'), async (req,res,next) => {
  try {
    if (!safeId(req.params.id)) return res.status(400).json({success:false,message:'Invalid doctor profile ID.'});
    const update = {};
    for (const key of ['specialty','department','subspecialty','licenseNumber','qualifications','availability','yearsExperience','consultationFee','active']) if (req.body[key] !== undefined) update[key] = req.body[key];
    if (update.specialty !== undefined && !doctorSpecialties.includes(update.specialty)) return res.status(400).json({success:false,message:'Choose a supported medical specialty.'});
    if (update.availability !== undefined && !['Available','Busy','On leave','Off duty'].includes(update.availability)) return res.status(400).json({success:false,message:'Choose a valid availability status.'});
    if (update.department !== undefined) update.department = cleanString(update.department,100);
    for (const key of ['subspecialty','licenseNumber','qualifications']) if (update[key] !== undefined) update[key] = cleanString(update[key], key === 'qualifications' ? 500 : 120);
    const data = await DoctorProfile.findByIdAndUpdate(req.params.id, {$set:update}, {new:true,runValidators:true}).populate('userId','name email role');
    if (!data) return res.status(404).json({success:false,message:'Doctor profile not found.'});
    await recordAudit(req,'update','doctor-profile',data._id,update.specialty || 'profile updated');
    res.json({success:true,data});
  } catch (e) { next(e); }
});

// Core operational modules. All routes are authenticated and role-scoped.
const staffRoles = ['admin','staff'];
const clinicalRoles = ['admin','doctor'];
const labRoles = ['admin','doctor','staff'];
async function recordAudit(req, action, resource, resourceId='', details='') {
  try { await AuditLog.create({ actorId: req.auth?.sub, action, resource, resourceId: String(resourceId || ''), details: String(details || '').slice(0,1000), ip: req.ip }); } catch (e) { console.error('Audit log write failed:', e.message); }
}
function cleanString(v, max=3000) { return String(v ?? '').trim().slice(0,max); }
function safeId(v) { return mongoose.isValidObjectId(v); }

app.get('/api/departments', authenticate, async (_req,res,next)=>{ try { res.json({success:true,data:await Department.find({active:true}).sort({name:1}).lean()}); } catch(e){next(e);} });
app.post('/api/departments', authenticate, allowRoles('admin'), async(req,res,next)=>{ try { const name=cleanString(req.body.name,100); if(!name) return res.status(400).json({success:false,message:'Department name is required.'}); const data=await Department.create({name,description:cleanString(req.body.description),head:cleanString(req.body.head,120)}); await recordAudit(req,'create','department',data._id,name); res.status(201).json({success:true,data}); }catch(e){next(e);} });
app.patch('/api/departments/:id', authenticate, allowRoles('admin'), async(req,res,next)=>{ try { if(!safeId(req.params.id)) return res.status(400).json({success:false,message:'Invalid department ID.'}); const data=await Department.findByIdAndUpdate(req.params.id,{$set:{...(req.body.name!==undefined?{name:cleanString(req.body.name,100)}:{}),...(req.body.description!==undefined?{description:cleanString(req.body.description)}:{}),...(req.body.head!==undefined?{head:cleanString(req.body.head,120)}:{}),...(req.body.active!==undefined?{active:Boolean(req.body.active)}:{})}},{new:true,runValidators:true}); if(!data)return res.status(404).json({success:false,message:'Department not found.'}); await recordAudit(req,'update','department',data._id); res.json({success:true,data}); }catch(e){next(e);} });

app.get('/api/medical-records', authenticate, allowRoles('admin','doctor','staff'), async(req,res,next)=>{try{const filter={}; if(req.query.patientId){if(!safeId(req.query.patientId))return res.status(400).json({success:false,message:'Invalid patient ID.'});filter.patientId=req.query.patientId;} const data=await ClinicalRecord.find(filter).populate('patientId','patientId name').sort({createdAt:-1}).limit(100).lean();res.json({success:true,data});}catch(e){next(e);} });
app.post('/api/medical-records', authenticate, allowRoles('doctor'), async(req,res,next)=>{try{const {patientId}=req.body;if(!safeId(patientId))return res.status(400).json({success:false,message:'A valid patient record is required.'});const data=await ClinicalRecord.create({patientId,authorId:req.auth.sub,appointmentId:safeId(req.body.appointmentId)?req.body.appointmentId:undefined,symptoms:cleanString(req.body.symptoms,4000),findings:cleanString(req.body.findings,6000),diagnosis:cleanString(req.body.diagnosis,4000),treatmentPlan:cleanString(req.body.treatmentPlan,6000),allergies:cleanString(req.body.allergies,2000)});await recordAudit(req,'create','medical-record',data._id);res.status(201).json({success:true,data,message:'Clinical note saved as draft.'});}catch(e){next(e);} });
app.patch('/api/medical-records/:id/sign', authenticate, allowRoles('doctor'), async(req,res,next)=>{try{if(!safeId(req.params.id))return res.status(400).json({success:false,message:'Invalid record ID.'});const data=await ClinicalRecord.findOneAndUpdate({_id:req.params.id,authorId:req.auth.sub,status:'Draft'},{$set:{status:'Signed'}},{new:true});if(!data)return res.status(404).json({success:false,message:'Draft record not found or not owned by this doctor.'});await recordAudit(req,'sign','medical-record',data._id);res.json({success:true,data});}catch(e){next(e);} });

app.get('/api/lab-orders', authenticate, allowRoles(...labRoles), async(req,res,next)=>{try{const filter={};if(req.query.patientId&&safeId(req.query.patientId))filter.patientId=req.query.patientId;const data=await LabOrder.find(filter).populate('patientId','patientId name').sort({createdAt:-1}).limit(200).lean();res.json({success:true,data});}catch(e){next(e);} });
app.post('/api/lab-orders', authenticate, allowRoles('doctor'), async(req,res,next)=>{try{if(!safeId(req.body.patientId)||!cleanString(req.body.testName,120))return res.status(400).json({success:false,message:'Patient and test name are required.'});const data=await LabOrder.create({patientId:req.body.patientId,orderedBy:req.auth.sub,testName:cleanString(req.body.testName,120),specimen:cleanString(req.body.specimen,120),urgent:Boolean(req.body.urgent)});await recordAudit(req,'create','lab-order',data._id);res.status(201).json({success:true,data});}catch(e){next(e);} });
app.patch('/api/lab-orders/:id', authenticate, allowRoles('admin','staff'), async(req,res,next)=>{try{if(!safeId(req.params.id))return res.status(400).json({success:false,message:'Invalid lab order ID.'});const allowed=['Collected','Processing','Result entered','Verified','Released','Cancelled'];const update={};if(req.body.status!==undefined){if(!allowed.includes(req.body.status))return res.status(400).json({success:false,message:'Invalid laboratory status.'});update.status=req.body.status;}if(req.body.result!==undefined)update.result=cleanString(req.body.result,4000);if(req.body.referenceRange!==undefined)update.referenceRange=cleanString(req.body.referenceRange,500);if(req.body.status==='Verified')update.verifiedBy=req.auth.sub;if(req.body.status==='Released')update.releasedAt=new Date();const data=await LabOrder.findByIdAndUpdate(req.params.id,{$set:update},{new:true,runValidators:true});if(!data)return res.status(404).json({success:false,message:'Lab order not found.'});await recordAudit(req,'update','lab-order',data._id,data.status);res.json({success:true,data});}catch(e){next(e);} });

app.get('/api/radiology-orders', authenticate, allowRoles('admin','doctor','staff'), async(req,res,next)=>{try{const data=await RadiologyOrder.find(req.query.patientId&&safeId(req.query.patientId)?{patientId:req.query.patientId}:{}).populate('patientId','patientId name').sort({createdAt:-1}).limit(200).lean();res.json({success:true,data});}catch(e){next(e);} });
app.post('/api/radiology-orders', authenticate, allowRoles('doctor'), async(req,res,next)=>{try{if(!safeId(req.body.patientId)||!cleanString(req.body.bodySite,120)||!['X-ray','Ultrasound','CT','MRI','Other'].includes(req.body.modality))return res.status(400).json({success:false,message:'Patient, valid imaging modality and body site are required.'});const data=await RadiologyOrder.create({patientId:req.body.patientId,orderedBy:req.auth.sub,modality:req.body.modality,bodySite:cleanString(req.body.bodySite,120)});await recordAudit(req,'create','radiology-order',data._id);res.status(201).json({success:true,data});}catch(e){next(e);} });
app.patch('/api/radiology-orders/:id', authenticate, allowRoles('admin','staff','doctor'), async(req,res,next)=>{try{if(!safeId(req.params.id))return res.status(400).json({success:false,message:'Invalid imaging order ID.'});const update={};if(req.body.status!==undefined){if(!['Requested','Scheduled','Completed','Reported','Cancelled'].includes(req.body.status))return res.status(400).json({success:false,message:'Invalid imaging status.'});update.status=req.body.status;}if(req.body.report!==undefined)update.report=cleanString(req.body.report,6000);if(req.body.scheduledAt!==undefined)update.scheduledAt=new Date(req.body.scheduledAt);const data=await RadiologyOrder.findByIdAndUpdate(req.params.id,{$set:update},{new:true,runValidators:true});if(!data)return res.status(404).json({success:false,message:'Imaging order not found.'});await recordAudit(req,'update','radiology-order',data._id);res.json({success:true,data});}catch(e){next(e);} });

app.get('/api/medicines', authenticate, allowRoles('admin','staff','doctor'), async(_req,res,next)=>{try{const data=await Medicine.find({active:true}).sort({name:1}).limit(500).lean();res.json({success:true,data,lowStock:data.filter(m=>m.quantity<=m.reorderLevel).length});}catch(e){next(e);} });
app.post('/api/medicines', authenticate, allowRoles('admin','staff'), async(req,res,next)=>{try{const name=cleanString(req.body.name,150),sku=cleanString(req.body.sku,80);const quantity=Number(req.body.quantity??0),unitPrice=Number(req.body.unitPrice??0);if(!name||!sku||!Number.isFinite(quantity)||quantity<0||!Number.isFinite(unitPrice)||unitPrice<0)return res.status(400).json({success:false,message:'Medicine name, SKU and valid stock/price are required.'});const data=await Medicine.create({name,sku,quantity,unitPrice,reorderLevel:Math.max(0,Number(req.body.reorderLevel)||0),batch:cleanString(req.body.batch,100),supplier:cleanString(req.body.supplier,150),expiryDate:req.body.expiryDate?new Date(req.body.expiryDate):undefined});await recordAudit(req,'create','medicine',data._id,sku);res.status(201).json({success:true,data});}catch(e){next(e);} });
app.post('/api/medicines/:id/transactions', authenticate, allowRoles('admin','staff'), async(req,res,next)=>{try{if(!safeId(req.params.id))return res.status(400).json({success:false,message:'Invalid medicine ID.'});const quantity=Number(req.body.quantity);const type=req.body.type;if(!Number.isInteger(quantity)||quantity<1||!['Received','Dispensed','Adjustment','Return'].includes(type))return res.status(400).json({success:false,message:'Select a valid transaction type and whole-number quantity.'});const medicine=await Medicine.findById(req.params.id);if(!medicine)return res.status(404).json({success:false,message:'Medicine not found.'});const delta=['Received','Return'].includes(type)?quantity:-quantity;if(medicine.quantity+delta<0)return res.status(409).json({success:false,message:'Insufficient stock for this transaction.'});medicine.quantity+=delta;await medicine.save();const transaction=await InventoryTransaction.create({medicineId:medicine._id,type,quantity,reason:cleanString(req.body.reason,500),actorId:req.auth.sub});await recordAudit(req,'inventory-transaction','medicine',medicine._id,`${type}: ${quantity}`);res.status(201).json({success:true,data:{medicine,transaction}});}catch(e){next(e);} });

app.get('/api/invoices', authenticate, allowRoles('admin','staff'), async(_req,res,next)=>{try{const data=await Invoice.find().populate('patientId','patientId name').sort({createdAt:-1}).limit(200).lean();res.json({success:true,data});}catch(e){next(e);} });
app.post('/api/invoices', authenticate, allowRoles('admin','staff'), async(req,res,next)=>{try{if(!safeId(req.body.patientId)||!Array.isArray(req.body.items)||!req.body.items.length)return res.status(400).json({success:false,message:'Patient and at least one invoice item are required.'});const items=req.body.items.map(i=>({description:cleanString(i.description,200),quantity:Math.max(1,Math.floor(Number(i.quantity)||1)),unitPrice:Number(i.unitPrice)}));if(items.some(i=>!i.description||!Number.isFinite(i.unitPrice)||i.unitPrice<0))return res.status(400).json({success:false,message:'Invoice items need descriptions and valid non-negative prices.'});const total=items.reduce((sum,i)=>sum+i.quantity*i.unitPrice,0);const invoiceNumber=`CP-INV-${Date.now()}-${Math.floor(Math.random()*900+100)}`;const data=await Invoice.create({patientId:req.body.patientId,invoiceNumber,items,total,createdBy:req.auth.sub});await recordAudit(req,'create','invoice',data._id,invoiceNumber);res.status(201).json({success:true,data});}catch(e){next(e);} });
app.post('/api/invoices/:id/payments', authenticate, allowRoles('admin','staff'), async(req,res,next)=>{try{if(!safeId(req.params.id))return res.status(400).json({success:false,message:'Invalid invoice ID.'});const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({success:false,message:'Payment amount must be greater than zero.'});const invoice=await Invoice.findById(req.params.id);if(!invoice||invoice.status==='Voided')return res.status(404).json({success:false,message:'Active invoice not found.'});if(invoice.paid+amount>invoice.total)return res.status(409).json({success:false,message:'Payment exceeds the outstanding invoice balance.'});const payment=await Payment.create({invoiceId:invoice._id,amount,method:['Cash','Card','Transfer','Insurance','Other'].includes(req.body.method)?req.body.method:'Other',reference:cleanString(req.body.reference,120),receivedBy:req.auth.sub});invoice.paid+=amount;invoice.status=invoice.paid>=invoice.total?'Paid':'Partially paid';await invoice.save();await recordAudit(req,'payment','invoice',invoice._id,`${amount}`);res.status(201).json({success:true,data:{invoice,payment}});}catch(e){next(e);} });

app.get('/api/wards', authenticate, allowRoles('admin','staff','doctor'), async(_req,res,next)=>{try{res.json({success:true,data:await Ward.find({active:true}).sort({name:1}).lean()});}catch(e){next(e);} });
app.post('/api/wards', authenticate, allowRoles('admin','staff'), async(req,res,next)=>{try{const name=cleanString(req.body.name,100),code=cleanString(req.body.code,30);if(!name||!code)return res.status(400).json({success:false,message:'Ward name and unique code are required.'});const beds=(Array.isArray(req.body.beds)?req.body.beds:[]).map(b=>({bedNumber:cleanString(b.bedNumber,30),status:'Available'}));if(beds.some(b=>!b.bedNumber))return res.status(400).json({success:false,message:'Every bed needs a bed number.'});const data=await Ward.create({name,code,beds});await recordAudit(req,'create','ward',data._id);res.status(201).json({success:true,data});}catch(e){next(e);} });
app.post('/api/admissions', authenticate, allowRoles('admin','staff','doctor'), async(req,res,next)=>{try{if(!safeId(req.body.patientId)||!safeId(req.body.wardId)||!cleanString(req.body.bedNumber,30))return res.status(400).json({success:false,message:'Patient, ward and bed are required.'});const ward=await Ward.findById(req.body.wardId);if(!ward)return res.status(404).json({success:false,message:'Ward not found.'});const bed=ward.beds.find(b=>b.bedNumber===String(req.body.bedNumber));if(!bed||bed.status!=='Available')return res.status(409).json({success:false,message:'Selected bed is unavailable.'});const existing=await Admission.findOne({patientId:req.body.patientId,status:'Admitted'});if(existing)return res.status(409).json({success:false,message:'This patient already has an active admission.'});bed.status='Occupied';bed.patientId=req.body.patientId;await ward.save();const data=await Admission.create({patientId:req.body.patientId,wardId:ward._id,bedNumber:bed.bedNumber,admittedBy:req.auth.sub,notes:cleanString(req.body.notes,2000)});await recordAudit(req,'admit','admission',data._id);res.status(201).json({success:true,data});}catch(e){next(e);} });
app.get('/api/admissions', authenticate, allowRoles('admin','staff','doctor'), async(_req,res,next)=>{try{res.json({success:true,data:await Admission.find().populate('patientId','patientId name').populate('wardId','name code').sort({admittedAt:-1}).limit(200).lean()});}catch(e){next(e);} });
app.patch('/api/admissions/:id/discharge', authenticate, allowRoles('admin','doctor'), async(req,res,next)=>{try{if(!safeId(req.params.id))return res.status(400).json({success:false,message:'Invalid admission ID.'});const admission=await Admission.findOne({_id:req.params.id,status:'Admitted'});if(!admission)return res.status(404).json({success:false,message:'Active admission not found.'});const ward=await Ward.findById(admission.wardId);if(ward){const bed=ward.beds.find(b=>b.bedNumber===admission.bedNumber);if(bed){bed.status='Available';bed.patientId=undefined;}await ward.save();}admission.status='Discharged';admission.dischargedAt=new Date();await admission.save();await recordAudit(req,'discharge','admission',admission._id);res.json({success:true,data:admission});}catch(e){next(e);} });

app.get('/api/notifications', authenticate, async(req,res,next)=>{try{const filter=req.auth.role==='admin'?{}:{userId:req.auth.sub};res.json({success:true,data:await Notification.find(filter).sort({createdAt:-1}).limit(100).lean()});}catch(e){next(e);} });
app.patch('/api/notifications/:id/read', authenticate, async(req,res,next)=>{try{if(!safeId(req.params.id))return res.status(400).json({success:false,message:'Invalid notification ID.'});const filter=req.auth.role==='admin'?{_id:req.params.id}:{_id:req.params.id,userId:req.auth.sub};const data=await Notification.findOneAndUpdate(filter,{$set:{read:true}},{new:true});if(!data)return res.status(404).json({success:false,message:'Notification not found.'});res.json({success:true,data});}catch(e){next(e);} });
app.get('/api/audit-logs', authenticate, allowRoles('admin'), async(req,res,next)=>{try{const data=await AuditLog.find().sort({createdAt:-1}).limit(Math.min(500,Number(req.query.limit)||100)).lean();res.json({success:true,data});}catch(e){next(e);} });
app.get('/api/staff-schedules', authenticate, allowRoles('admin','staff','doctor'), async(req,res,next)=>{try{const filter=req.auth.role==='doctor'?{userId:req.auth.sub}:{};res.json({success:true,data:await StaffSchedule.find(filter).populate('userId','name email role').sort({shiftStart:1}).limit(200).lean()});}catch(e){next(e);} });
app.post('/api/staff-schedules', authenticate, allowRoles('admin','staff'), async(req,res,next)=>{try{if(!safeId(req.body.userId)||!req.body.shiftStart||!req.body.shiftEnd||new Date(req.body.shiftEnd)<=new Date(req.body.shiftStart))return res.status(400).json({success:false,message:'Choose a staff member and a valid shift start/end.'});const data=await StaffSchedule.create({userId:req.body.userId,department:cleanString(req.body.department,100),shiftStart:new Date(req.body.shiftStart),shiftEnd:new Date(req.body.shiftEnd),notes:cleanString(req.body.notes,1000)});await recordAudit(req,'create','staff-schedule',data._id);res.status(201).json({success:true,data});}catch(e){next(e);} });
app.get('/api/dashboard/summary', authenticate, allowRoles('admin','staff','doctor'), async(_req,res,next)=>{try{const [patients,appointments,activeAdmissions,pendingLab,lowStock,unpaidInvoices]=await Promise.all([Patient.countDocuments(),Appointment.countDocuments({status:{$in:['Scheduled','Checked in','In consultation']}}),Admission.countDocuments({status:'Admitted'}),LabOrder.countDocuments({status:{$in:['Requested','Collected','Processing','Result entered']}}),Medicine.countDocuments({$expr:{$lte:['$quantity','$reorderLevel']},active:true}),Invoice.countDocuments({status:{$in:['Unpaid','Partially paid']}})]);res.json({success:true,data:{patients,activeAppointments:appointments,activeAdmissions,pendingLabOrders:pendingLab,lowStockMedicines:lowStock,unpaidInvoices}});}catch(e){next(e);} });

app.use((req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` }));
app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.name === 'ValidationError') return res.status(400).json({ success: false, message: 'Validation failed.', errors: Object.values(error.errors).map(item => item.message) });
  if (error?.code === 11000) return res.status(409).json({ success: false, message: 'A record with this unique value already exists.' });
  return res.status(500).json({ success: false, message: 'Unexpected server error.' });
});

async function start() {
  if (process.env.MONGODB_URI && !process.env.MONGODB_URI.includes('YOUR_DATABASE_USER') && !process.env.MONGODB_URI.includes('YOUR_CLUSTER')) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
      console.log('MongoDB connected.');
    } catch (error) {
      console.error('MongoDB connection failed:', error.message);
      console.error('Check MONGODB_URI, database password encoding, and Atlas Network Access. API will start without database access.');
    }
  } else {
    console.warn('MongoDB is not configured. Edit backend/.env to connect your database.');
  }
  app.listen(port, () => console.log(`CarePoint API listening at http://localhost:${port}`));
}
start();
