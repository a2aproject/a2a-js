import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  username: String,
  // Add other fields as needed
});

export const User = mongoose.model('User', UserSchema);