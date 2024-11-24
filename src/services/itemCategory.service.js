const mongoose = require('mongoose');
const { ItemCategoryModel } = require('../models');
const CONSTANTS = require("../config/constant");

// Create a new category
const createCategory = async ({ categoryName, categoryType, parentCategory, tax, inheritParentTax }) => {
    const category = new ItemCategoryModel({
        categoryName,
        categoryType,
        parentCategory: parentCategory || null,
        tax: parentCategory ? null : tax, // Only set tax if not inheriting from parent
        inheritParentTax: inheritParentTax !== undefined ? inheritParentTax : !!parentCategory // Default to true if parentCategory exists
    });
    await category.save();
    return category;
};

// Get the applicable tax rate for a category
const getCategoryTax = async (categoryId) => {
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw new Error("Invalid category ID");
    }

    const category = await ItemCategoryModel.findById(categoryId);

    if (!category) {
        throw new Error("Category not found");
    }

    // If inheritParentTax is true, look up the parent's tax rate
    if (category.inheritParentTax && category.parentCategory) {
        const parentCategory = await ItemCategoryModel.findById(category.parentCategory);
        return parentCategory ? parentCategory.tax : category.tax;
    }

    // Otherwise, return the category's own tax rate
    return category.tax;
};

// Get categories by type (product, food, room)
const getCategoriesByType = async (categoryType) => {
    const categories = await ItemCategoryModel.find({ categoryType, parentCategory: null });
    const categoriesWithSubcategories = await Promise.all(categories.map(async (category) => {
        const subcategories = await ItemCategoryModel.find({ parentCategory: category._id });
        return {
            ...category.toObject(),
            subcategories
        };
    }));

    return categoriesWithSubcategories;
};

// Get all categories with optional filters, pagination, and sorting
const getAllCategories = async ({ page = 1, limit = 10, sortBy = 'asc', search, status, categoryType }) => {
    const query = { isDelete: 1 };
    if (status === '1') {
        query.status = 1;
    } else if (status === '0') {
        query.status = 0;
    }

    if (search) {
        query.categoryName = { $regex: search, $options: 'i' };
    }
    if (categoryType) {
        query.categoryType = categoryType;
    }
    const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        sort: { categoryName: sortBy === 'asc' ? 1 : -1 },
    };

    const categories = await ItemCategoryModel.paginate(query, options);
    return categories;
};

// Get category by category ID
const getCategoryById = async (categoryId) => {
    // Validate categoryId
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw new Error(CONSTANTS.INVALID_CATEGORY_ID);
    }

    const category = await ItemCategoryModel.findById(categoryId).populate('parentCategory', 'categoryName');
    if (!category) {
        throw new Error(CONSTANTS.CATEGORY_NOT_FOUND);
    }
    return category;
};

// Get subcategories by parent category ID
const getSubcategoriesByParent = async (parentCategoryId) => {
    if (!mongoose.Types.ObjectId.isValid(parentCategoryId)) { throw new Error("Invalid parent category ID") }

    const subcategories = await ItemCategoryModel.find({ parentCategory: parentCategoryId })
        .populate('parentCategory', 'categoryName');

    if (subcategories.length === 0) { throw new Error(CONSTANTS.INVALID_PARENT_ID) }
    return subcategories;
};

// Update a category
const updateCategory = async (categoryId, categoryData) => {
    // Validate categoryId
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw new Error(CONSTANTS.INVALID_CATEGORY_ID);
    }

    // Validate categoryType
    if (categoryData.categoryType && !['food', 'room', 'product'].includes(categoryData.categoryType)) {
        throw new Error(CONSTANTS.INVALID_CATEGORY_TYPE);
    }

    const updatedCategory = await ItemCategoryModel.findByIdAndUpdate(categoryId, categoryData, { new: true });
    if (!updatedCategory) {
        throw new Error(CONSTANTS.CATEGORY_NOT_FOUND);
    }
    return updatedCategory;
};

// Delete a category
const deleteCategory = async (categoryId) => {
    const deletedCategory = await ItemCategoryModel.findByIdAndDelete(categoryId);
    if (!deletedCategory) {
        throw new Error(CONSTANTS.CATEGORY_NOT_FOUND);
    }
    return deletedCategory;
};

module.exports = {
    createCategory,
    getCategoryTax,
    getCategoriesByType,
    getCategoryById,
    getSubcategoriesByParent,
    getAllCategories,
    updateCategory,
    deleteCategory
};