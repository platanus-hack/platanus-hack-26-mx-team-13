import mongoose from "mongoose";
import toJSON from "./plugins/toJSON.js";

// USER SCHEMA — backs authentication.
const userSchema = mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    image: {
      type: String,
    },
    // Role-based access control.
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    // The user's default empresa/constancia — preselected in the upload modal and
    // used to invoice a ticket when none is chosen explicitly. Null until set.
    defaultCompanyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

// Convert mongoose docs to clean JSON (_id -> id, drop __v).
userSchema.plugin(toJSON);

// Hot-reload guard: reuse the compiled model if it already exists.
export default mongoose.models.User || mongoose.model("User", userSchema);
