import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../models.js';
const ownerEmail=String(process.env.OWNER_ADMIN_EMAIL||'setemiadelokun11@gmail.com').trim().toLowerCase();
if(!process.env.MONGODB_URI || !process.env.JWT_SECRET || process.env.JWT_SECRET.length<32){console.error('Configure MONGODB_URI and a private JWT_SECRET in backend/.env first.');process.exit(1);}
try{
 await mongoose.connect(process.env.MONGODB_URI);
 const owner=await User.findOne({email:ownerEmail});
 if(!owner || owner.role!=='admin' || owner.active===false){console.error(`Owner account ${ownerEmail} must exist as an active admin before running this migration. Create it with npm run user:create first.`);process.exitCode=1;}
 else {
  const result=await User.updateMany({role:'admin',email:{$ne:ownerEmail}},{$set:{role:'staff'}});
  console.log(`Primary owner verified: ${ownerEmail}. Demoted ${result.modifiedCount} existing admin account(s) to staff; no accounts or patient records were deleted.`);
  console.log('The owner can now create additional admins in the Users & Permissions page.');
 }
}catch(error){console.error('Owner migration failed:',error.message);process.exitCode=1;}finally{await mongoose.disconnect().catch(()=>{});}
