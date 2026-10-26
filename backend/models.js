import mongoose from 'mongoose';

const patientSchema = new mongoose.Schema({
  patientId: { type: String, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, trim: true, lowercase: true, default: '' },
  department: { type: String, trim: true, default: 'General Medicine' },
  doctor: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['Waiting', 'Checked in', 'In consultation', 'Completed'], default: 'Waiting' },
  visitDate: { type: Date, default: Date.now }
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['patient', 'admin', 'doctor', 'staff'], default: 'patient' },
  active: { type: Boolean, default: true }
}, { timestamps: true });

export const Patient = mongoose.models.Patient || mongoose.model('Patient', patientSchema);
export const User = mongoose.models.User || mongoose.model('User', userSchema);

const appointmentSchema = new mongoose.Schema({ patientName: { type: String, required: true, trim: true, maxlength: 120 }, patientEmail: { type: String, trim: true, lowercase: true, default: '' }, doctor: { type: String, required: true, trim: true }, doctorUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, department: { type: String, default: 'General Medicine' }, date: { type: Date, required: true }, notes: { type: String, maxlength: 1000, default: '' }, status: { type: String, enum: ['Scheduled','Checked in','In consultation','Completed','Cancelled'], default: 'Scheduled' } }, { timestamps: true });
export const Appointment = mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);


const departmentSchema = new mongoose.Schema({ name: {type:String,required:true,trim:true,unique:true}, description:{type:String,default:''}, head:{type:String,default:''}, active:{type:Boolean,default:true} }, {timestamps:true});
const clinicalRecordSchema = new mongoose.Schema({ patientId:{type:mongoose.Schema.Types.ObjectId,ref:'Patient',required:true,index:true}, appointmentId:{type:mongoose.Schema.Types.ObjectId,ref:'Appointment'}, authorId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true}, symptoms:{type:String,default:'',maxlength:4000}, findings:{type:String,default:'',maxlength:6000}, diagnosis:{type:String,default:'',maxlength:4000}, treatmentPlan:{type:String,default:'',maxlength:6000}, allergies:{type:String,default:'',maxlength:2000}, status:{type:String,enum:['Draft','Signed','Amended'],default:'Draft'}, amendmentNote:{type:String,default:''} },{timestamps:true});
const labOrderSchema = new mongoose.Schema({ patientId:{type:mongoose.Schema.Types.ObjectId,ref:'Patient',required:true,index:true}, orderedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true}, testName:{type:String,required:true,trim:true}, specimen:{type:String,default:''}, status:{type:String,enum:['Requested','Collected','Processing','Result entered','Verified','Released','Cancelled'],default:'Requested'}, result:{type:String,default:''}, referenceRange:{type:String,default:''}, urgent:{type:Boolean,default:false}, verifiedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User'}, releasedAt:{type:Date} },{timestamps:true});
const medicineSchema = new mongoose.Schema({ name:{type:String,required:true,trim:true}, sku:{type:String,required:true,unique:true,trim:true}, batch:{type:String,default:''}, supplier:{type:String,default:''}, quantity:{type:Number,min:0,default:0}, reorderLevel:{type:Number,min:0,default:10}, unitPrice:{type:Number,min:0,default:0}, expiryDate:{type:Date}, active:{type:Boolean,default:true} },{timestamps:true});
const inventoryTransactionSchema = new mongoose.Schema({ medicineId:{type:mongoose.Schema.Types.ObjectId,ref:'Medicine',required:true}, type:{type:String,enum:['Received','Dispensed','Adjustment','Return'],required:true}, quantity:{type:Number,required:true,min:1}, reason:{type:String,default:''}, actorId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true} },{timestamps:true});
const invoiceSchema = new mongoose.Schema({ patientId:{type:mongoose.Schema.Types.ObjectId,ref:'Patient',required:true,index:true}, invoiceNumber:{type:String,required:true,unique:true}, items:[{description:{type:String,required:true},quantity:{type:Number,min:1,default:1},unitPrice:{type:Number,min:0,required:true}}], total:{type:Number,min:0,required:true}, paid:{type:Number,min:0,default:0}, status:{type:String,enum:['Unpaid','Partially paid','Paid','Voided'],default:'Unpaid'}, createdBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true} },{timestamps:true});
const paymentSchema = new mongoose.Schema({ invoiceId:{type:mongoose.Schema.Types.ObjectId,ref:'Invoice',required:true,index:true}, amount:{type:Number,min:0.01,required:true}, method:{type:String,enum:['Cash','Card','Transfer','Insurance','Other'],default:'Cash'}, reference:{type:String,default:''}, receivedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true} },{timestamps:true});
const wardSchema = new mongoose.Schema({ name:{type:String,required:true,trim:true}, code:{type:String,required:true,unique:true}, beds:[{bedNumber:{type:String,required:true},status:{type:String,enum:['Available','Occupied','Out of service'],default:'Available'},patientId:{type:mongoose.Schema.Types.ObjectId,ref:'Patient'}}], active:{type:Boolean,default:true} },{timestamps:true});
const admissionSchema = new mongoose.Schema({ patientId:{type:mongoose.Schema.Types.ObjectId,ref:'Patient',required:true,index:true}, wardId:{type:mongoose.Schema.Types.ObjectId,ref:'Ward',required:true}, bedNumber:{type:String,required:true}, admittedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true}, admittedAt:{type:Date,default:Date.now}, dischargedAt:{type:Date}, status:{type:String,enum:['Admitted','Transferred','Discharged'],default:'Admitted'}, notes:{type:String,default:''} },{timestamps:true});
const radiologyOrderSchema = new mongoose.Schema({ patientId:{type:mongoose.Schema.Types.ObjectId,ref:'Patient',required:true,index:true}, orderedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true}, modality:{type:String,enum:['X-ray','Ultrasound','CT','MRI','Other'],required:true}, bodySite:{type:String,required:true}, status:{type:String,enum:['Requested','Scheduled','Completed','Reported','Cancelled'],default:'Requested'}, report:{type:String,default:''}, scheduledAt:{type:Date} },{timestamps:true});
const notificationSchema = new mongoose.Schema({ userId:{type:mongoose.Schema.Types.ObjectId,ref:'User',index:true}, title:{type:String,required:true}, message:{type:String,required:true}, read:{type:Boolean,default:false}, type:{type:String,default:'info'} },{timestamps:true});
const auditLogSchema = new mongoose.Schema({ actorId:{type:mongoose.Schema.Types.ObjectId,ref:'User'}, action:{type:String,required:true}, resource:{type:String,required:true}, resourceId:{type:String,default:''}, details:{type:String,default:''}, ip:{type:String,default:''} },{timestamps:true});
const staffScheduleSchema = new mongoose.Schema({ userId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true}, department:{type:String,default:''}, shiftStart:{type:Date,required:true}, shiftEnd:{type:Date,required:true}, status:{type:String,enum:['Scheduled','Completed','Cancelled'],default:'Scheduled'}, notes:{type:String,default:''} },{timestamps:true});
export const Department = mongoose.models.Department || mongoose.model('Department', departmentSchema);
export const ClinicalRecord = mongoose.models.ClinicalRecord || mongoose.model('ClinicalRecord', clinicalRecordSchema);
export const LabOrder = mongoose.models.LabOrder || mongoose.model('LabOrder', labOrderSchema);
export const Medicine = mongoose.models.Medicine || mongoose.model('Medicine', medicineSchema);
export const InventoryTransaction = mongoose.models.InventoryTransaction || mongoose.model('InventoryTransaction', inventoryTransactionSchema);
export const Invoice = mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);
export const Payment = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);
export const Ward = mongoose.models.Ward || mongoose.model('Ward', wardSchema);
export const Admission = mongoose.models.Admission || mongoose.model('Admission', admissionSchema);
export const RadiologyOrder = mongoose.models.RadiologyOrder || mongoose.model('RadiologyOrder', radiologyOrderSchema);
export const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
export const StaffSchedule = mongoose.models.StaffSchedule || mongoose.model('StaffSchedule', staffScheduleSchema);

// A doctor remains a doctor account, while this profile records the clinician's
// distinct specialty, registration, department and appointment availability.
const doctorProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  specialty: { type: String, required: true, enum: ['General Practitioner','Family Medicine','Internal Medicine','Cardiology','Neurology','Neurosurgery','Paediatrics','Obstetrics & Gynaecology','General Surgery','Orthopaedic Surgery','Plastic Surgery','Urology','Ophthalmology','Otolaryngology (ENT)','Dermatology','Psychiatry','Psychology','Radiology','Anaesthesiology','Emergency Medicine','Oncology','Pathology','Haematology','Endocrinology','Gastroenterology','Nephrology','Pulmonology','Infectious Diseases','Rheumatology','Dentistry','Oral & Maxillofacial Surgery','Physiotherapy','Other'] },
  subspecialty: { type: String, default: '', maxlength: 120 },
  department: { type: String, required: true, trim: true, maxlength: 100 },
  licenseNumber: { type: String, trim: true, maxlength: 100, default: '' },
  qualifications: { type: String, trim: true, maxlength: 500, default: '' },
  yearsExperience: { type: Number, min: 0, max: 70, default: 0 },
  consultationFee: { type: Number, min: 0, default: 0 },
  availability: { type: String, enum: ['Available','Busy','On leave','Off duty'], default: 'Available' },
  active: { type: Boolean, default: true }
}, { timestamps: true });
export const DoctorProfile = mongoose.models.DoctorProfile || mongoose.model('DoctorProfile', doctorProfileSchema);
