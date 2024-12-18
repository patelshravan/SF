const mongoose = require("mongoose");
const { AdminSettingModel } = require('../models');

const cartSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    guestId: { type: String },
    items: [{
        item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true }, // Unified field for room, food, or product
        variantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant' }, // Reference the Variant model
        quantity: { type: Number, required: true, min: 1 }, // For rooms, this could represent the number of nights
        selectedSize: { type: String }, // Optional for room bookings, can be omitted
        selectedColor: { type: String }, // Optional for room bookings, can be omitted
        checkIn: { type: Date }, // Check-in date for room bookings
        checkOut: { type: Date }, // Check-out date for room bookings
        guestCount: { type: Number, required: function () { return this.itemType === 'room'; } }
    }],
    deliveryAddress: {
        name: { type: String, required: function () { return this.requiresDeliveryAddress(); } },
        street: { type: String, required: function () { return this.requiresDeliveryAddress(); } },
        city: { type: String, required: function () { return this.requiresDeliveryAddress(); } },
        state: { type: String },
        country: { type: String, required: function () { return this.requiresDeliveryAddress(); } },
        postalCode: { type: String, required: function () { return this.requiresDeliveryAddress(); } },
        phone: { type: String, required: function () { return this.requiresDeliveryAddress(); } }
    },
    subtotal: { type: Number, required: true, default: 0 },
    tax: { type: Number, required: true, default: 0 },
    deliveryCharge: { type: Number, required: true, default: 0 },
    commission: { type: Number, required: true, default: 0 },
    totalPrice: { type: Number, required: true, default: 0 }
}, {
    timestamps: true
});

// Helper method to check if delivery address is required
cartSchema.methods.requiresDeliveryAddress = function () {
    // Check if any item in the cart requires a delivery address
    return this.items.some(item => item.itemType === 'food' || item.itemType === 'product');
};

// Middleware for calculating subtotal, tax, and total price (for rooms, food, or products)
cartSchema.pre('save', async function (next) {
    let subtotal = 0;
    let totalDeliveryCharge = 0;
    let totalTax = 0;
    let totalCommission = 0;

    // Retrieve the commission percentage from system settings
    const systemSettings = await AdminSettingModel.findOne();
    const commissionPercentage = systemSettings ? systemSettings.commission : 0;

    for (let item of this.items) {
        const product = await mongoose.model('Item').findById(item.item);
        if (!product) return next(new Error('Item not found.'));

        let pricePerUnit = 0;
        let itemDeliveryCharge = 0;
        let itemTaxRate = 0;

        // Handle room items
        if (product.itemType === 'room') {
            const checkIn = new Date(item.checkIn);
            const checkOut = new Date(item.checkOut);
            const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
            pricePerUnit = product.roomPrice * nights;
            itemDeliveryCharge = 0;
            const roomCategory = await mongoose.model('ItemCategory').findById(product.roomCategory);
            itemTaxRate = roomCategory ? roomCategory.tax : 0;

            // Validate room quantity
            if (item.quantity > product.quantity) {
                return next(new Error('Quantity exceeds available stock for the selected room.'));
            }
        }

        // Handle food items
        else if (product.itemType === 'food') {
            pricePerUnit = product.dishPrice || 0;
            itemDeliveryCharge = product.foodDeliveryCharge || 0;
            const foodCategory = await mongoose.model('ItemCategory').findById(product.parentCategory);
            itemTaxRate = foodCategory ? foodCategory.tax : 0;

            // Validate food quantity
            if (item.quantity > product.quantity) {
                return next(new Error('Quantity exceeds available stock for the selected food item.'));
            }
        }

        // Handle product items
        else if (product.itemType === 'product') {
            // Validate product.variants
            if (!product.variants || !Array.isArray(product.variants)) {
                console.error('Product variants are missing or invalid:', product.variants);
                return next(new Error('Invalid product variants.'));
            }

            // Match variantId, converting both sides to strings
            const variant = product.variants.find(v => {
                if (!v.variantId) {
                    console.error('Variant missing variantId:', v);
                    return false;
                }
                return v.variantId.toString() === item.variantId?.toString();
            });

            if (!variant) {
                console.error('No matching variant found for variantId:', item.variantId);
                return next(new Error('Invalid variant selected.'));
            }

            // Validate variant quantity
            if (item.quantity > variant.quantity) {
                return next(new Error('Quantity exceeds available stock for the selected variant.'));
            }

            pricePerUnit = variant.productPrice || 0;
            itemDeliveryCharge = product.productDeliveryCharge || 0;
            const productCategory = await mongoose.model('ItemCategory').findById(product.parentCategory);
            itemTaxRate = productCategory ? productCategory.tax : 0;
        }

        // Validate price
        if (isNaN(pricePerUnit) || pricePerUnit <= 0) {
            return next(new Error('Invalid price for the item.'));
        }

        // Calculate item price, tax, and commission amount
        item.price = pricePerUnit * item.quantity;
        const itemTaxCost = (item.price * itemTaxRate) / 100;
        const itemCommissionCost = (item.price * commissionPercentage) / 100;

        subtotal += item.price;
        totalDeliveryCharge += itemDeliveryCharge;
        totalTax += itemTaxCost;
        totalCommission += itemCommissionCost;
    }

    // Set totals in the cart
    this.subtotal = subtotal;
    this.tax = totalTax;
    this.deliveryCharge = totalDeliveryCharge;
    this.commission = totalCommission;
    this.totalPrice = this.subtotal + this.tax + this.deliveryCharge + this.commission;

    next();
});

const Cart = mongoose.model("Cart", cartSchema);

module.exports = Cart;