// const httpStatus = require('http-status');
const { AdminModel, AdminRoles } = require('../../models');
const CONSTANTS = require('../../config/constant');
const Token = require('../../models/token.model');
const { tokenTypes } = require('../../config/tokens');
const tokenService = require('../token.service');
const s3Service = require('../s3.service');
const crypto = require("crypto");
const mailFunctions = require("../../helpers/mailFunctions");
const adminStaffService = require('./adminStaff.service');
const bcrypt = require('bcryptjs');

/**
 * Get user by id
 * @param {ObjectId} id
 * @returns {Promise<User>}
 */
const getAdminById = async (id) => {
  return AdminModel.findById(id);
};

/**
 * Update company by id
 * @param {ObjectId} adminId
 * @param {Object} updateBody
 * @returns {Promise<Company>}
 */

const updateAdminById = async (adminId, updateBody, files) => {
  const admin = await getAdminById(adminId);
  if (!admin) {
    return { data: {}, statusCode: CONSTANTS.NOT_FOUND, message: CONSTANTS.COMPANY_USER_NOT_FOUND };
  }
  if (updateBody.email && (await AdminModel.isEmailTaken(updateBody.email, adminId))) {
    return { data: {}, statusCode: CONSTANTS.BAD_REQUEST, message: CONSTANTS.ADMIN_STAFF_EMAIL_ALREADY_EXISTS };
  }
  if (updateBody.phone && (await AdminModel.isMobileTaken(updateBody.phone, adminId))) {
    return { data: {}, statusCode: CONSTANTS.BAD_REQUEST, message: CONSTANTS.ADMIN_STAFF_MOBILE_ALREADY_EXISTS };
  }

  var uploadResult;
  if (files && files.length !== 0) {
    uploadResult = await s3Service.uploadDocuments(files, 'admin-profile-photo', '');
  }
  if (uploadResult && uploadResult.length !== 0) {
    updateBody.profilePhoto = uploadResult[0].key;
  }

  Object.assign(admin, updateBody);
  await admin.save();

  return { data: admin, statusCode: CONSTANTS.SUCCESSFUL, message: CONSTANTS.ADMIN_STAFF_UPDATE };
};

/**
 * Update password by admin ID
 * @param {ObjectId} adminId
 * @param {string} newPassword
 * @returns {Promise<Admin>}
 */
const updatePasswordById = async (adminId, newPassword) => {
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  const updatedAdmin = await AdminModel.findOneAndUpdate(
    { _id: adminId },
    { password: hashedPassword },
    { new: true, runValidators: false }
  );

  if (!updatedAdmin) {
    return { data: {}, code: CONSTANTS.NOT_FOUND, message: CONSTANTS.COMPANY_USER_NOT_FOUND };
  }

  return { data: updatedAdmin, code: CONSTANTS.SUCCESSFUL, message: "Password changed successfully." };
};

/**
 * Get user by email
 * @param {string} email
 * @returns {Promise<User>}
 */
const getAdminByEmail = async (email) => {
  return AdminModel.findOne({ email });
};

const getAdminByPhone = async (phone) => {
  return AdminModel.findOne({ phone });
};

/**
 * Login with username and password
 * @param {string} email
 * @param {string} password
 * @returns {Promise<User>}
 */
const loginUserWithEmailOrPhone = async (emailOrPhone, password, req) => {
  let details;
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailOrPhone);

  if (isEmail) {
    details = await getAdminByEmail(emailOrPhone);
    if (!details) {
      // For staff login, fetch details and populate role
      details = await adminStaffService.getAdminStaffByEmail(emailOrPhone);
      if (details) {
        details = await details.populate('role');
        details.type = 'staff';
      }
    } else {
      details.type = 'superadmin';
    }
  } else {
    const isPhone = /^\d{10,}$/.test(emailOrPhone);
    if (isPhone) {
      details = await getAdminByPhone(emailOrPhone);
      if (!details) {
        // For staff login, fetch details and populate role
        details = await adminStaffService.getAdminStaffByPhone(emailOrPhone);
        if (details) {
          details = await details.populate('role');
          details.type = 'staff';
        }
      } else {
        details.type = 'superadmin';
      }
    } else {
      return { data: {}, code: CONSTANTS.BAD_REQUEST, message: 'Invalid email address/phone number' };
    }
  }

  // Validate password
  if (!details || !(await details.isPasswordMatch(password))) {
    return { data: {}, code: CONSTANTS.UNAUTHORIZED, message: CONSTANTS.UNAUTHORIZED_MSG };
  }

  // Generate tokens
  const tokens = await tokenService.generateAuthTokens(details);

  // Superadmin response structure
  if (details.type === 'superadmin') {
    return {
      data: {
        user: {
          registeredAddress: details.registeredAddress,
          name: details.name,
          email: details.email,
          emailOtpVerificationStatus: details.emailOtpVerificationStatus,
          type: details.type,
          status: details.status,
          isDelete: details.isDelete,
          createdAt: details.createdAt,
          updatedAt: details.updatedAt,
          id: details._id.toString(),
        },
        tokens,
      },
      code: CONSTANTS.SUCCESSFUL,
      message: CONSTANTS.LOGIN_MSG,
    };
  }

  // Staff login with role details
  let roleDetails = null;
  if (details.type === 'staff' && details.role) {
    roleDetails = await AdminRoles.findById(details.role._id).select('name resource');
  }

  return {
    data: {
      user: {
        _id: details._id,
        name: details.name,
        email: details.email,
        phone: details.fullPhoneNumber || details.phone,
        type: details.type,
        role: details.type === 'staff' ? roleDetails : undefined, // Only include role for staff
      },
      tokens,
    },
    code: CONSTANTS.SUCCESSFUL,
    message: CONSTANTS.LOGIN_MSG,
  };
};

/**
 * Login with username and password
 * @param {string} email
 * @param {string} password
 * @returns {Promise<User>}
 */
const validateUserWithEmail = async (email) => {
  var details;
  details = await getAdminByEmail(email);
  if (details == null) {
    details = await getStaffByEmail(email);
  }
  return details;
};

/**
 * Logout
 * @param {string} refreshToken
 * @returns {Promise}
 */
const logout = async (refreshToken) => {
  const refreshTokenDoc = await Token.findOne({ token: refreshToken, type: tokenTypes.REFRESH, blacklisted: false });
  if (!refreshTokenDoc) {
    return { data: {}, code: CONSTANTS.NOT_FOUND, message: CONSTANTS.NOT_FOUND_MSG }
  }
  await refreshTokenDoc.remove();
};

/**
 * Refresh auth tokens
 * @param {string} refreshToken
 * @returns {Promise<Object>}
 */
const refreshAuth = async (refreshToken) => {
  try {
    const refreshTokenDoc = await tokenService.verifyToken(refreshToken, tokenTypes.REFRESH);
    const user = await getAdminById(refreshTokenDoc.user);
    if (!user) {
      throw new Error();
    }
    await refreshTokenDoc.remove();
    return tokenService.generateAuthTokens(user);
  } catch (error) {
    return { data: {}, code: CONSTANTS.UNAUTHORIZED, message: CONSTANTS.UNAUTHORIZED_MSG }
  }
};

/**
 * Forgot Password: Generate OTP and send it via email to admin
 * @param {string} email
 * @returns {Promise}
 */
const forgotPassword = async (email) => {
  try {
    const admin = await getAdminByEmail(email);
    if (!admin) {
      return {
        data: {},
        code: CONSTANTS.NOT_FOUND,
        message: CONSTANTS.EMAIL_NOT_FOUND,
      };
    }

    const emailOtp = crypto.randomInt(1000, 9999).toString();
    admin.passwordResetEmailOTP = emailOtp;
    admin.otpGeneratedAt = new Date();
    await admin.save();

    await mailFunctions.sendOtpOnMail(admin.email, admin.name || "Admin", emailOtp);

    const resetPasswordToken = await tokenService.generateResetPasswordToken(admin._id);
    return {
      data: { id: admin._id, token: resetPasswordToken },
      code: CONSTANTS.SUCCESSFUL,
      message: CONSTANTS.FORGOT_PASSWORD,
    };
  } catch (error) {
    console.error("Error in forgotPassword service:", error);
    return {
      data: {},
      code: CONSTANTS.INTERNAL_SERVER_ERROR,
      message: "An error occurred during the forgot password process.",
    };
  }
};

/**
 * Verify OTP for password reset
 * @param {string} email
 * @param {string} otp
 * @returns {Promise}
 */
const verifyOtp = async (email, otp) => {
  const admin = await getAdminByEmail(email);
  if (!admin) { return { data: {}, code: CONSTANTS.NOT_FOUND, message: CONSTANTS.ADMIN_NOT_FOUND } }

  const otpExpiryTime = 15 * 60 * 1000;
  const isOtpValid = admin.passwordResetEmailOTP === otp && (new Date() - admin.otpGeneratedAt) < otpExpiryTime;

  if (!isOtpValid) { return { data: {}, code: CONSTANTS.UNAUTHORIZED, message: 'Invalid or expired OTP' } }

  admin.passwordResetEmailOTP = undefined;
  admin.otpGeneratedAt = undefined;
  admin.emailOtpVerificationStatus = true;
  await admin.save();

  return { data: { admin }, code: CONSTANTS.SUCCESSFUL, message: 'OTP verified successfully' };
};

/**
 * Reset password after verifying OTP
 * @param {string} email
 * @param {string} newPassword
 * @returns {Promise}
 */
const resetPassword = async (resetPasswordToken, newPassword) => {
  try {
    const resetPasswordTokenDoc = await tokenService.verifyToken(resetPasswordToken, tokenTypes.RESET_PASSWORD);
    const admin = await AdminModel.findOne({ _id: resetPasswordTokenDoc.user });

    if (!admin) { return { data: {}, code: CONSTANTS.NOT_FOUND, message: CONSTANTS.ADMIN_NOT_FOUND } }

    if (!admin.emailOtpVerificationStatus) { return { data: {}, code: CONSTANTS.UNAUTHORIZED, message: CONSTANTS.OTP_NOT_VERIFIED } }

    // Check if the new password is the same as the old password
    const isSameAsOldPassword = await admin.isPasswordMatch(newPassword);
    if (isSameAsOldPassword) { return { data: {}, code: CONSTANTS.BAD_REQUEST, message: CONSTANTS.SAME_PASSWORD_ERROR_MSG } }

    // Update the admin's password
    admin.password = newPassword;
    admin.emailOtpVerificationStatus = false;
    await admin.save();

    // Remove the token after successful password reset
    await Token.deleteMany({ user: admin._id, type: tokenTypes.RESET_PASSWORD });
    return { data: {}, code: CONSTANTS.SUCCESSFUL, message: CONSTANTS.CHANGE_PASSWORD };
  } catch (error) {
    console.error("Error resetting password:", error);
    return { data: {}, code: CONSTANTS.UNAUTHORIZED, message: CONSTANTS.PASSWORD_RESET_FAIL };
  }
};

module.exports = {
  getAdminByEmail,
  getAdminById,
  updateAdminById,
  updatePasswordById,
  validateUserWithEmail,
  loginUserWithEmailOrPhone,
  logout,
  refreshAuth,
  forgotPassword,
  verifyOtp,
  resetPassword
};