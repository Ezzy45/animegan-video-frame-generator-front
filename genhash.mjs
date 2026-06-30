import bcrypt from 'bcryptjs';
const hash = await bcrypt.hash('motdepasse123', 12);
console.log(hash);