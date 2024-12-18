const { ItemModel, BusinessModel } = require('../models');
const { s3Service } = require('../services');

// Create an item (Food, Room, or Product)
const createItem = async (itemData, files, partnerId) => {
    let imageUrls = [];
    let variantsWithImages = [];
    const business = await BusinessModel.findOne({ _id: itemData.businessId, partner: partnerId });
    if (!business) {
        throw new Error('Invalid business ID. The provided business ID does not belong to the authenticated partner.');
    }
    try {
        // Handle image uploads for the main item
        if (files && files.length > 0) {
            const mainImages = files.filter(file => file.fieldname === 'images');
            const uploadResults = await s3Service.uploadDocuments(mainImages, 'item-images');
            imageUrls = uploadResults.map(upload => upload.key);
        }

        // Build base item object
        const item = {
            business: itemData.businessId,
            businessType: itemData.businessTypeId,
            itemType: itemData.itemType,
            images: imageUrls,
            available: itemData.available || true,
            partner: partnerId,
            parentCategory: itemData.parentCategory,
            subCategory: itemData.subCategory,
        };

        // Add quantity for food and rooms
        if (itemData.itemType === 'food' || itemData.itemType === 'room') {
            item.quantity = itemData.quantity;
        }

        // Handle room-specific fields
        if (itemData.itemType === 'room') {
            item.roomName = itemData.roomName;
            item.roomDescription = itemData.roomDescription;
            item.roomPrice = itemData.roomPrice;
            item.roomCapacity = itemData.roomCapacity;
            item.roomCategory = itemData.roomCategory;
            item.amenities = Array.isArray(itemData.amenities) ? itemData.amenities : [];

            // Only assign checkIn and checkOut if provided
            if (itemData.checkIn) {
                item.checkIn = new Date(itemData.checkIn);
            }
            if (itemData.checkOut) {
                item.checkOut = new Date(itemData.checkOut);
            }
        }

        // Handle product-specific fields, including variants with quantity and images
        if (itemData.itemType === 'product') {
            item.productName = itemData.productName;
            item.productDescription = itemData.productDescription;
            item.productDeliveryCharge = itemData.productDeliveryCharge;
            item.productFeatures = itemData.productFeatures;
            item.nonReturnable = itemData.nonReturnable || false;

            // Parse and validate variants
            if (itemData.variants) {
                const variants = Array.isArray(itemData.variants)
                    ? itemData.variants
                    : JSON.parse(itemData.variants);

                // Handle images for each variant
                const variantImages = files.filter(file => file.fieldname.startsWith('variants'));
                for (let i = 0; i < variants.length; i++) {
                    const variantField = `variants[${i}][variantImages]`;
                    const variantFile = variantImages.find(file =>
                        file.fieldname === variantField || file.fieldname === `variants[${i}][variantImage]`
                    );

                    // Upload variant image if available
                    if (variantFile) {
                        const uploadResult = await s3Service.uploadDocuments([variantFile], 'variant-images');
                        variants[i].image = uploadResult[0].key; // Assign uploaded image to variant
                    }
                }

                // Map variants with their details
                variantsWithImages = variants.map(variant => {
                    if (!variant.quantity || variant.quantity < 0) {
                        throw new Error(`Quantity must be a positive number for variant: ${variant.variantId}`);
                    }

                    return {
                        variantId: variant.variantId,
                        productPrice: variant.productPrice,
                        quantity: variant.quantity, // Include quantity for the variant
                        image: variant.image || null,
                    };
                });
            }

            item.variants = variantsWithImages;
        }

        // Handle food-specific fields
        if (itemData.itemType === 'food') {
            item.dishName = itemData.dishName;
            item.dishDescription = itemData.dishDescription;
            item.dishPrice = itemData.dishPrice;
            item.foodDeliveryCharge = itemData.foodDeliveryCharge;
            item.ingredients = Array.isArray(itemData.ingredients) ? itemData.ingredients : JSON.parse(itemData.ingredients || '[]');
            item.spicyLevel = itemData.spicyLevel || 'medium'; // Optional, default is 'medium'
        }

        // Save item to database
        const newItem = new ItemModel(item);
        await newItem.save();
        return newItem;

    } catch (error) {
        console.error("Error in createItem:", error.message);

        // Return detailed error for validation issues
        if (error.name === 'ValidationError') {
            const validationErrors = Object.values(error.errors).map(err => err.message);
            throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
        }

        // Generic fallback error
        throw new Error("Failed to create item. Please check your data format.");
    }
};

// Get item by item ID
const getItemById = async (itemId) => {
    const item = await ItemModel.findById(itemId)
        .populate('parentCategory', 'tax categoryName')
        .populate('subCategory', 'tax categoryName')
        .populate('variants.variantId', 'variantName size color'); // Populate variant details

    if (!item) {
        throw new Error('Item not found');
    }

    const taxRate = item.parentCategory ? item.parentCategory.tax : item.subCategory ? item.subCategory.tax : 0;

    // Map variants if the item is a product
    const variants = item.itemType === 'product'
        ? item.variants.map(variant => ({
            variantId: variant.variantId?._id,
            variantName: variant.variantId?.variantName || null,
            size: variant.variantId?.size || null,
            color: variant.variantId?.color || null,
            productPrice: variant.productPrice,
            image: variant.image || null,
        }))
        : undefined;

    return {
        ...item.toObject(),
        taxRate, // Include the tax rate as set by the admin
        variants, // Include mapped variants for product items
    };
};

// Get items by business ID
const getItemsByBusiness = async (businessId, page = 1, limit = 10) => {
    const items = await ItemModel.find({ business: businessId })
        .populate('parentCategory', 'tax')
        .sort({ createdAt: -1 }) // Sort by createdAt in descending order
        .skip((page - 1) * limit)
        .limit(limit)
        .exec();

    const itemsWithTax = items.map(item => {
        const taxRate = item.parentCategory ? item.parentCategory.tax : 0;

        return {
            ...item.toObject(),
            taxRate // Directly return the tax rate set by the admin
        };
    });

    return itemsWithTax;
};

// Get items by businessType ID
const getItemsByBusinessType = async (businessTypeId, page = 1, limit = 10) => {
    const skip = (page - 1) * limit;

    const items = await ItemModel.find({ businessType: businessTypeId })
        .skip(skip)
        .limit(limit)
        .exec();

    const totalDocs = await ItemModel.countDocuments({ businessType: businessTypeId });

    return {
        docs: items,
        totalDocs,
        limit,
        totalPages: Math.ceil(totalDocs / limit),
        page,
        pagingCounter: (page - 1) * limit + 1,
        hasPrevPage: page > 1,
        hasNextPage: page * limit < totalDocs,
        prevPage: page > 1 ? page - 1 : null,
        nextPage: page * limit < totalDocs ? page + 1 : null,
    };
};

// Get all rooms by business ID
const getRoomsByBusiness = async (businessId, page = 1, limit = 10, sortOrder = 'asc') => {
    const skip = (page - 1) * limit;

    // Check if the businessId is valid
    const business = await BusinessModel.findById(businessId);
    if (!business) {
        throw new Error('Invalid business ID');
    }

    // Determine sort order
    const sort = { createdAt: sortOrder === 'desc' ? -1 : 1 };

    // Fetch rooms with sorting and populating related fields
    const rooms = await ItemModel.find({
        business: businessId,
        itemType: 'room'
    })
        .populate('roomCategory', 'categoryName tax') // Populate category name and tax
        .populate('business', 'businessName') // Populate business name
        .populate('businessType', 'name') // Populate business type name
        .sort(sort) // Sort by addition status (createdAt)
        .skip(skip)
        .limit(limit)
        .exec();

    const totalDocs = await ItemModel.countDocuments({
        business: businessId,
        itemType: 'room'
    });

    // Structure the response
    return {
        docs: rooms.map(room => ({
            _id: room._id,
            roomName: room.roomName,
            roomPrice: room.roomPrice,
            images: room.images,
            businessName: room.business ? room.business.businessName : 'Unknown',
            businessTypeName: room.businessType ? room.businessType.name : 'Unknown',
            taxRate: room.roomCategory ? room.roomCategory.tax : 0,
            createdAt: room.createdAt // Include creation time
        })),
        totalDocs,
        limit,
        totalPages: Math.ceil(totalDocs / limit),
        page,
        pagingCounter: (page - 1) * limit + 1,
        hasPrevPage: page > 1,
        hasNextPage: page * limit < totalDocs,
        prevPage: page > 1 ? page - 1 : null,
        nextPage: page * limit < totalDocs ? page + 1 : null,
    };
};

// Get all rooms by business ID
const getFoodByBusiness = async (businessId, page = 1, limit = 10, sortOrder = 'desc') => {
    const skip = (page - 1) * limit;

    // Fetch business details
    const business = await BusinessModel.findById(businessId).select(
        'businessName businessDescription businessAddress mobile email'
    );
    if (!business) {
        throw new Error('Invalid business ID');
    }

    // Format the address
    const address = business.businessAddress
        ? `${business.businessAddress.street}, ${business.businessAddress.city}, ${business.businessAddress.state}, ${business.businessAddress.country}, ${business.businessAddress.postalCode}`
        : 'No address available';

    // Determine sort order
    const sort = { createdAt: sortOrder === 'desc' ? -1 : 1 };

    // Fetch food items
    const foods = await ItemModel.find({
        business: businessId,
        itemType: 'food',
    })
        .populate('parentCategory', '_id categoryName') // Include _id in parentCategory
        .populate('subCategory', 'categoryName')
        .select('dishName dishDescription dishPrice foodDeliveryCharge available images createdAt parentCategory subCategory')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .exec();

    const totalDocs = await ItemModel.countDocuments({
        business: businessId,
        itemType: 'food',
    });

    // Group items by parent category and subcategory
    const groupedData = foods.reduce((result, item) => {
        const parentCategoryName = item.parentCategory?.categoryName || 'Uncategorized';
        const parentCategoryId = item.parentCategory?._id || null;
        const subCategoryName = item.subCategory?.categoryName || 'Uncategorized';

        if (!result[parentCategoryName]) {
            result[parentCategoryName] = {
                _id: parentCategoryId, // Include parent category ID
                subCategories: [],
            };
        }

        let subCategory = result[parentCategoryName].subCategories.find(sub => sub[subCategoryName]);
        if (!subCategory) {
            subCategory = { [subCategoryName]: [] };
            result[parentCategoryName].subCategories.push(subCategory);
        }

        subCategory[subCategoryName].push({
            _id: item._id,
            dishName: item.dishName,
            dishDescription: item.dishDescription,
            dishPrice: item.dishPrice,
            foodDeliveryCharge: item.foodDeliveryCharge,
            available: item.available,
            images: item.images,
            createdAt: item.createdAt,
        });

        return result;
    }, {});

    // Return response
    return {
        businessDetails: {
            name: business.businessName,
            description: business.businessDescription || 'No description available',
            address,
        },
        categories: groupedData,
        totalDocs,
        limit,
        totalPages: Math.ceil(totalDocs / limit),
        page,
        pagingCounter: (page - 1) * limit + 1,
        hasPrevPage: page > 1,
        hasNextPage: page * limit < totalDocs,
        prevPage: page > 1 ? page - 1 : null,
        nextPage: page * limit < totalDocs ? page + 1 : null,
    };
};

// Get all rooms by business ID
const getProductByBusiness = async (businessId, page = 1, limit = 10, sortOrder = 'desc') => {
    const skip = (page - 1) * limit;

    // Check if the businessId is valid
    const business = await BusinessModel.findById(businessId);
    if (!business) {
        throw new Error('Invalid business ID');
    }

    // Determine sort order based on sortOrder parameter
    const sort = { createdAt: sortOrder === 'desc' ? -1 : 1 };

    // Fetch product items with sorting, categories, and tax information
    const products = await ItemModel.find({
        business: businessId,
        itemType: 'product'
    })
        .populate('parentCategory', 'categoryName tax') // Populate parent category name and tax
        .populate('subCategory', 'categoryName') // Populate subcategory name
        .populate('business', 'businessName') // Populate business name
        .populate('businessType', 'name') // Populate business type name
        .populate({
            path: 'variants.variantId', // Populate variantId fields
            select: 'variantName size color', // Select specific fields from the Variant model
        })
        .sort(sort) // Apply sorting by creation time
        .skip(skip)
        .limit(limit)
        .exec();

    const totalDocs = await ItemModel.countDocuments({
        business: businessId,
        itemType: 'product'
    });

    // Structure the response to include categorized items
    const categorizedItems = products.reduce((acc, item) => {
        const parentCat = item.parentCategory ? item.parentCategory.categoryName : 'Uncategorized';
        const subCat = item.subCategory ? item.subCategory.categoryName : 'Uncategorized';
        const taxRate = item.parentCategory ? item.parentCategory.tax : 0;

        // Initialize categories in the accumulator
        if (!acc[parentCat]) {
            acc[parentCat] = {};
        }

        // Initialize subcategories
        if (!acc[parentCat][subCat]) {
            acc[parentCat][subCat] = [];
        }

        // Push item details into the right category and subcategory
        acc[parentCat][subCat].push({
            _id: item._id,
            productName: item.productName,
            productDescription: item.productDescription,
            productFeatures: item.productFeatures,
            productDeliveryCharge: item.productDeliveryCharge,
            nonReturnable: item.nonReturnable,
            variants: item.variants.map(variant => ({
                variantId: variant.variantId?._id,
                variantName: variant.variantId?.variantName || null,
                size: variant.variantId?.size || null,
                color: variant.variantId?.color || null,
                productPrice: variant.productPrice,
                image: variant.image || null, // Include variant image
            })),
            images: item.images,
            businessName: item.business ? item.business.businessName : 'Unknown',
            businessTypeName: item.businessType ? item.businessType.name : 'Unknown',
            taxRate, // Include tax rate
            createdAt: item.createdAt // Include creation time
        });

        return acc;
    }, {});

    return {
        docs: categorizedItems,
        totalDocs,
        limit,
        totalPages: Math.ceil(totalDocs / limit),
        page,
        pagingCounter: (page - 1) * limit + 1,
        hasPrevPage: page > 1,
        hasNextPage: page * limit < totalDocs,
        prevPage: page > 1 ? page - 1 : null,
        nextPage: page * limit < totalDocs ? page + 1 : null,
    };
};

// Update an item by ID
const updateItemById = async (itemId, updateData, files) => {
    const item = await ItemModel.findById(itemId);
    if (!item) throw new Error('Item not found');

    // Separate files for item and variant images
    const itemImages = files ? files.filter(file => file.fieldname === 'images') : [];
    const variantImages = files ? files.filter(file => file.fieldname.startsWith('variants')) : [];

    // Handle item image uploads
    if (itemImages.length > 0) {
        const uploadResults = await s3Service.uploadDocuments(itemImages, 'itemImages');
        const imageUrls = uploadResults.map(upload => upload.key);
        item.images = [...(item.images || []), ...imageUrls];
    }

    // Handle variant image updates
    if (updateData.variants && Array.isArray(updateData.variants)) {
        for (const variantUpdate of updateData.variants) {
            // Find the matching variant by variantId
            const variant = item.variants.find(v => v.variantId.toString() === variantUpdate.variantId);
            if (variant) {
                // Update variant properties if they exist in the update
                if (variantUpdate.quantity !== undefined) {
                    if (variantUpdate.quantity < 0) {
                        throw new Error('Quantity cannot be negative');
                    }
                    variant.quantity = variantUpdate.quantity;
                }
                if (variantUpdate.productPrice !== undefined) {
                    variant.productPrice = variantUpdate.productPrice;
                }

                // Handle variant image updates
                const variantField = `variants[${variant.variantId}][variantImage]`;
                const variantFile = variantImages.find(file => file.fieldname === variantField);

                if (variantFile) {
                    // Await is valid here since this is an async function
                    const uploadResult = await s3Service.uploadDocuments([variantFile], 'variant-images');
                    variant.image = uploadResult[0].key;
                }
            } else {
                throw new Error(`Variant with ID ${variantUpdate.variantId} not found`);
            }
        }
    }

    // Handle updates for other fields
    Object.keys(updateData).forEach(key => {
        if (key !== 'images' && key !== 'variants') {
            item[key] = updateData[key];
        }
    });

    // Save the updated item
    try {
        await item.save();
    } catch (error) {
        console.error('Error saving item:', error);
        throw new Error('Failed to update the item');
    }

    return item;
};

// Delete an item by ID
const deleteItemById = async (itemId) => {
    const item = await ItemModel.findById(itemId);
    if (!item) { throw new Error('Item not found') }
    const imageKeys = item.images.map(imageUrl => {
        const urlParts = imageUrl.split('/');
        return urlParts.slice(-2).join('/');
    });

    if (imageKeys.length > 0) { await s3Service.deleteFromS3(imageKeys) }
    await ItemModel.findByIdAndDelete(itemId);
};

// Guest Users

// Get all items (products, food, rooms)
const getAllItems = async (itemType, businessId, page = 1, limit = 10, sortOrder = 'desc') => {
    const skip = (page - 1) * limit;

    const filter = {};
    if (itemType) {
        filter.itemType = itemType;
    }
    if (businessId) {
        filter.business = businessId;
    }

    // Determine sort order
    const sort = { createdAt: sortOrder === 'desc' ? -1 : 1 };

    // Fetch items with populated category and business data
    const items = await ItemModel.find(filter)
        .populate('parentCategory', 'categoryName tax') // Populate parent category name and tax
        .populate('subCategory', 'categoryName') // Populate subcategory name
        .populate('roomCategory', 'categoryName tax') // Populate room category name and tax
        .populate('business', 'businessName') // Populate business name
        .populate('businessType', 'name') // Populate business type name
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(); // Return plain JavaScript objects

    const totalDocs = await ItemModel.countDocuments(filter);

    // Group items by categories
    const categorizedItems = items.reduce((acc, item) => {
        let categoryName;
        let subCategoryName = null; // Default to no subcategory
        let taxRate = 0;

        if (item.itemType === 'room') {
            // For room items, use only the roomCategory
            categoryName = item.roomCategory?.categoryName || 'Uncategorized';
            taxRate = item.roomCategory?.tax || 0;

            if (!acc[categoryName]) {
                acc[categoryName] = { items: [] };
            }

            // Add room item directly to the category
            acc[categoryName].items.push({
                _id: item._id,
                name: item.roomName || 'Unknown',
                description: item.roomDescription || 'No description',
                price: item.roomPrice || 0,
                taxRate,
                quantity: item.quantity || 0,
                available: item.available || true,
                images: item.images || [],
                businessName: item.business?.businessName || 'Unknown',
                businessTypeName: item.businessType?.name || 'Unknown',
                createdAt: item.createdAt,
            });
        } else {
            // For product and food items, group by parent and subcategories
            categoryName = item.parentCategory?.categoryName || 'Uncategorized';
            subCategoryName = item.subCategory?.categoryName || 'Uncategorized';
            taxRate = item.parentCategory?.tax || 0;

            if (!acc[categoryName]) {
                acc[categoryName] = {};
            }
            if (!acc[categoryName][subCategoryName]) {
                acc[categoryName][subCategoryName] = [];
            }

            acc[categoryName][subCategoryName].push({
                _id: item._id,
                name: item.productName || item.dishName || 'Unknown',
                description: item.productDescription || item.dishDescription || 'No description',
                price: item.productPrice || item.dishPrice || 0,
                deliveryCharge: item.productDeliveryCharge || item.foodDeliveryCharge || null,
                taxRate,
                quantity: item.quantity || 0,
                available: item.available || true,
                images: item.images || [],
                variants: item.variants?.map(variant => ({
                    variantId: variant.variantId?._id,
                    variantName: variant.variantId?.variantName || null,
                    size: variant.variantId?.size || null,
                    color: variant.variantId?.color || null,
                    productPrice: variant.productPrice,
                    image: variant.image || null,
                })) || [],
                businessName: item.business?.businessName || 'Unknown',
                businessTypeName: item.businessType?.name || 'Unknown',
                createdAt: item.createdAt,
            });
        }

        return acc;
    }, {});

    return {
        docs: categorizedItems,
        totalDocs,
        limit,
        totalPages: Math.ceil(totalDocs / limit),
        page,
        pagingCounter: (page - 1) * limit + 1,
        hasPrevPage: page > 1,
        hasNextPage: page * limit < totalDocs,
        prevPage: page > 1 ? page - 1 : null,
        nextPage: page * limit < totalDocs ? page + 1 : null,
    };
};

// Search items by query
const searchItems = async (search) => {
    return await ItemModel.find({
        $or: [
            { productName: { $regex: search, $options: 'i' } },
            { dishName: { $regex: search, $options: 'i' } },
            { roomName: { $regex: search, $options: 'i' } },
        ]
    });
};

// Delete image from item
const deleteImageFromItem = async (itemId, imageKey, variantId = null) => {
    const item = await ItemModel.findById(itemId);
    if (!item) {
        throw new Error('Item not found');
    }

    // If variantId is provided, remove the image from the specific variant
    if (variantId) {
        const variant = item.variants.find((v) => v.variantId.toString() === variantId);
        if (!variant) {
            throw new Error('Variant not found');
        }

        const imageIndex = variant.image.indexOf(imageKey);
        if (imageIndex === -1) {
            throw new Error('Image not found in the variant');
        }

        // Remove the image from the variant
        variant.image.splice(imageIndex, 1);
    } else {
        // Remove the image from the main item images
        const imageIndex = item.images.indexOf(imageKey);
        if (imageIndex === -1) {
            throw new Error('Image not found in the item');
        }

        // Remove the image
        item.images.splice(imageIndex, 1);
    }

    // Save changes to the item
    await item.save();

    // Delete the image from S3
    await s3Service.deleteFromS3([imageKey]);
};

module.exports = {
    createItem,
    getItemById,
    getItemsByBusiness,
    getRoomsByBusiness,
    getFoodByBusiness,
    getProductByBusiness,
    getItemsByBusinessType,
    updateItemById,
    deleteItemById,
    getAllItems,
    searchItems,
    deleteImageFromItem
};