const mongoose = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");


const itemCategorySchema = new mongoose.Schema({
    categoryName: { type: String, required: true },
    categoryType: {
        type: String,
        required: true,
        enum: ['product', 'food', 'room']  // Specify valid types
    },
    parentCategory: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ItemCategory',
        default: null,
        validate: {
            validator: function () {
                // Allow parentCategory to be null for room types
                return this.categoryType !== 'room' || this.parentCategory === null;
            },
            message: "Parent category is not allowed for room types."
        }
    },
    tax: { type: Number, default: 0 },
    inheritParentTax: { type: Boolean, default: false },
    status: { type: Number, default: 1 }, //0 is Inactive, 1 is Active
    isDelete: { type: Number, default: 1 },
}, {
    timestamps: true
});


itemCategorySchema.plugin(mongoosePaginate);
const ItemCategoryModel = mongoose.model("ItemCategory", itemCategorySchema);

module.exports = ItemCategoryModel;