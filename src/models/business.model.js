const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const daywiseTimingSchema = new mongoose.Schema({
    day: { type: String, required: true },
    openingTime: { type: String, required: true },
    closingTime: { type: String, required: true }
}, { _id: false });

const addressSchema = new mongoose.Schema({
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, required: true },
    postalCode: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    location: {
        type: { type: String, enum: ['Point'], required: true },
        coordinates: { type: [Number], required: true }
    }
}, { _id: false });

addressSchema.index({ location: '2dsphere' });

const businessSchema = new mongoose.Schema(
    {
        partner: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
        businessName: { type: String, required: true },
        businessType: { type: mongoose.Schema.Types.ObjectId, ref: 'businessType' },
        businessDescription: { type: String, required: true },
        countryCode: {
            type: String,
            required: true,
            validate: {
                validator: function (v) {
                    return /^\+\d{1,4}$/.test(v);
                },
                message: props => `${props.value} is not a valid country code!`
            },
            example: "+1"
        },
        mobile: { type: String, required: true },
        fullPhoneNumber: { type: String },
        email: { type: String, required: true },
        businessAddress: { type: addressSchema, required: true },
        openingDays: [{ type: String, required: true }],
        sameTimeForAllDays: { type: Boolean, required: true },  // true if same time for all days, false for different timings for each day
        uniformTiming: {
            openingTime: { type: String },
            closingTime: { type: String }
        },  // For uniform timings across all days
        daywiseTimings: {
            type: [daywiseTimingSchema],
            validate: {
                validator: function (value) {
                    if (!this.sameTimeForAllDays && (!value || value.length === 0)) {
                        return false;
                    }
                    return true;
                },
                message: 'daywiseTimings is required when sameTimeForAllDays is false.'
            }
        },
        bannerImages: [{ type: String }],
        galleryImages: [{ type: String }],
        isDelete: { type: Number, default: 1 }, // Default to active
        status: { type: Number, default: 1 }, // Default to active

        // Dine-in functionality
        dineInStatus: { type: Boolean, default: false },
        operatingDetails: [{
            date: { type: String },
            startTime: { type: String },
            endTime: { type: String }
        }],
        tableManagement: [{
            tableNumber: { type: String },
            seatingCapacity: { type: Number },
            status: { type: String, enum: ["available", "booked", "cancelled"], default: "available" }
        }],
    },
    {
        timestamps: true
    }
);

// Pre-save hook to concatenate the country code and mobile number into a full phone number
businessSchema.pre("save", function (next) {
    this.fullPhoneNumber = `${this.countryCode}${this.mobile}`;

    if (!this.dineInStatus) {
        this.operatingDetails = [];
        this.tableManagement = [];
    }

    next();
});

businessSchema.plugin(mongoosePaginate);

const Business = mongoose.model('Business', businessSchema);

module.exports = Business;