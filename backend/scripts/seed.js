import 'dotenv/config';
import mongoose from 'mongoose';
import { Department, Ward } from '../models.js';
if (!process.env.MONGODB_URI || /YOUR_DATABASE_USER|YOUR_CLUSTER|CHANGE_THIS/.test(process.env.MONGODB_URI)) {
  console.error('Configure a real MONGODB_URI in backend/.env before seeding.'); process.exit(1);
}
try {
  await mongoose.connect(process.env.MONGODB_URI);
  const departments = ['General Medicine','Paediatrics','Maternity','Surgery','Emergency','Laboratory','Radiology','Pharmacy'];
  for (const name of departments) await Department.updateOne({name},{$setOnInsert:{name,description:`${name} department`,active:true}},{upsert:true});
  await Ward.updateOne({code:'WARD-A'},{$setOnInsert:{name:'General Ward A',code:'WARD-A',beds:Array.from({length:10},(_,i)=>({bedNumber:`A-${String(i+1).padStart(2,'0')}`,status:'Available'}))}},{upsert:true});
  console.log('CarePoint reference data seeded: departments and a sample ward. No users or patient records were created.');
} catch (e) { console.error('Seed failed:',e.message); process.exitCode=1; }
finally { await mongoose.disconnect().catch(()=>{}); }
