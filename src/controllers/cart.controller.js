const catchAsync = require('../utils/catchAsync');
const { CartService } = require('../services');
const CONSTANTS = require("../config/constant");
const mongoose = require('mongoose');

// Add an item (food, product or checkout for rooms) to the cart
const addToCart = catchAsync(async (req, res) => {
    const { itemId, quantity, selectedSize, selectedColor, checkIn, checkOut, guestCount, deliveryAddress } = req.body;
    const userId = req.user._id;
    
    if (!mongoose.isValidObjectId(itemId)) {
        return res.status(400).json({ statusCode: 400, message: CONSTANTS.INVALID_ITEM_ID });
    }

    try {
        const cart = await CartService.addToCart(userId, itemId, quantity, selectedSize, selectedColor, checkIn, checkOut, guestCount, deliveryAddress);
        return res.status(200).json({ statusCode: 200, message: CONSTANTS.ADDED_TO_CART, cart });
    } catch (error) {
        return res.status(500).json({ statusCode: 500, message: 'An unexpected error occurred.', error: error.message });
    }
});

// Get the current user's cart
const getCart = catchAsync(async (req, res) => {
    const userId = req.user._id;
    try {
        const cart = await CartService.getCartByUser(userId);
        if (!cart) { return res.status(404).json({ statusCode: 404, message: CONSTANTS.CART_NOT_FOUND }) }
        return res.status(200).json({ statusCode: 200, data: cart });
    } catch (error) {
        return res.status(403).json({ statusCode: 403, message: error.message });
    }
});

// Remove an item from the cart
const removeFromCart = catchAsync(async (req, res) => {
    const { itemId } = req.body;
    const userId = req.user._id;

    if (!itemId) {
        return res.status(400).json({ statusCode: 400, message: "Item ID is missing." });
    }

    try {
        const updatedCart = await CartService.removeFromCart(userId, itemId);
        return res.status(200).json({ statusCode: 200, message: CONSTANTS.REMOVED_FROM_CART, updatedCart });
    } catch (error) {
        return res.status(500).json({ statusCode: 500, message: error.message });
    }
});

// Update cart item quantity
const updateCartItem = catchAsync(async (req, res) => {
    const { itemId, quantity } = req.body;
    const userId = req.user._id;

    try {
        const updatedCart = await CartService.updateCartItem(userId, itemId, quantity);
        return res.status(200).json({ statusCode: 200, message: CONSTANTS.CART_UPDATED, updatedCart });
    } catch (error) {
        return res.status(500).json({ statusCode: 500, message: error.message });
    }
});

// Clear the cart
const clearCart = catchAsync(async (req, res) => {
    const userId = req.user._id;
    try {
        const cart = await CartService.clearCart(userId);
        return res.status(200).json({
            statusCode: 200,
            message: CONSTANTS.CART_CLEARED,
            data: cart
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            statusCode: error.statusCode || 500,
            message: error.message || 'An error occurred while clearing the cart.'
        });
    }
});


// Add an item to the guest cart
const addGuestToCart = catchAsync(async (req, res) => {
    const { cartId, itemId, quantity, selectedSize, selectedColor, checkIn, checkOut, deliveryAddress } = req.body; // Ensure deliveryAddress is included

    try {
        const cart = await CartService.addGuestToCart(cartId, itemId, quantity, selectedSize, selectedColor, checkIn, checkOut, deliveryAddress);
        return res.status(200).json({ statusCode: 200, message: CONSTANTS.ADDED_TO_CART, cart });
    } catch (error) {
        return res.status(500).json({ statusCode: 500, message: 'An unexpected error occurred.', error: error.message });
    }
});

// Get the guest cart
const getGuestCart = catchAsync(async (req, res) => {
    const { cartId } = req.params; // Get cartId from URL parameters
    try {
        const cart = await CartService.getGuestCart(cartId); // Pass the cartId to the service
        return res.status(200).json({ statusCode: 200, data: cart });
    } catch (error) {
        return res.status(404).json({ statusCode: 404, message: error.message });
    }
});

// Remove an item from the guest cart
const removeFromGuestCart = catchAsync(async (req, res) => {
    const { guestId, cartItemId } = req.body;
    try {
        const updatedCart = await CartService.removeFromGuestCart(guestId, cartItemId);
        return res.status(200).json({ statusCode: 200, message: CONSTANTS.REMOVED_FROM_CART, updatedCart });
    } catch (error) {
        return res.status(500).json({ statusCode: 500, message: error.message });
    }
});

// Clear the guest cart
const clearGuestCart = catchAsync(async (req, res) => {
    const { guestId } = req.body;
    try {
        const cart = await CartService.clearGuestCart(guestId);
        return res.status(200).json({ statusCode: 200, message: CONSTANTS.CART_CLEARED, data: cart });
    } catch (error) {
        return res.status(500).json({ statusCode: 500, message: error.message });
    }
});

module.exports = {
    addToCart,
    getCart,
    removeFromCart,
    updateCartItem,
    clearCart,
    addGuestToCart,
    getGuestCart,
    removeFromGuestCart,
    clearGuestCart
};