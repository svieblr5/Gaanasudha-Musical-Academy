// Set (reset) a user's password from the command line.
//   node scripts/set-password.js <username> <newPassword>
// Example:  node scripts/set-password.js admin "MyStr0ng Pass!"
import { loadUsers, saveUsers, hashPassword } from '../src/auth.js';

const [, , username, newPassword] = process.argv;

if (!username || !newPassword) {
  console.error('Usage: node scripts/set-password.js <username> <newPassword>');
  process.exit(1);
}
if (newPassword.length < 6) {
  console.error('Password must be at least 6 characters.');
  process.exit(1);
}

const users = loadUsers();
const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
if (!user) {
  console.error(`No user named "${username}".`);
  process.exit(1);
}

user.password = hashPassword(newPassword);
saveUsers(users);
console.log(`Password updated for "${user.username}". It takes effect immediately.`);
