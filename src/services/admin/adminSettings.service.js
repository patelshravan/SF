const { AdminSettingModel } = require('../../models');
const CONSTANTS = require('../../config/constant')

/**
 * Create or update system settings
 * @param {Object} settingsData
 * @returns {Promise<Object>}
 */
const createSettings = async (settingsData) => {
    let settings = await AdminSettingModel.findOne({ settingsId: 1 }); // Look for existing settings with settingsId: 1
    if (settings) {
        // Update existing settings document
        settings = Object.assign(settings, settingsData);
        await settings.save();
        return settings;
    } else {
        // Create new settings document with settingsId: 1
        const newSettings = new AdminSettingModel({ ...settingsData, settingsId: 1 });
        await newSettings.save();
        return newSettings;
    }
}

/**
 * Get system settings
 * @returns {Promise<Object>}
 */
const getSettings = async () => {
    const systemSettings = await AdminSettingModel.findOne();
    if (!systemSettings) {
        throw new Error("admin settings not found");
    }
    return systemSettings;
};

/**
 * Update system settings
 * @param {ObjectId} settingsId
 * @param {Object} settingsData
 * @returns {Promise<Object>}
 */
const updateSettings = async (settingsId, settingsData) => {
    let systemSettings = await AdminSettingModel.findById(settingsId);
    if (!systemSettings) {
        throw new Error("Admin settings not found");
    }

    // Determine if only commission is being updated
    const isOnlyCommissionUpdated = Object.keys(settingsData).length === 1 && settingsData.hasOwnProperty('commission');

    // Update the settings
    systemSettings = Object.assign(systemSettings, settingsData);
    await systemSettings.save();

    // Return appropriate message
    const message = isOnlyCommissionUpdated
        ? CONSTANTS.COMMISSION_UPDATED
        : CONSTANTS.SETTINGS_UPDATED;

    return { systemSettings, message };
};

/**
 * Delete system settings
 * @param {ObjectId} settingsId
 * @returns {Promise<void>}
 */
const deleteSettings = async (settingsId) => {
    const systemSettings = await AdminSettingModel.findByIdAndDelete(settingsId);
    if (!systemSettings) {
        throw new Error("admin settings not found");
    }
};

module.exports = {
    createSettings,
    getSettings,
    updateSettings,
    deleteSettings,
};