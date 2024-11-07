const { OrderModel, CartModel, DineOutModel } = require('../models');
const CONSTANTS = require('../config/constant');
const mongoose = require('mongoose');

// Create a new order
const createOrder = async (userId, cartId, paymentMethod, orderNote) => {
    const customOrderId = Math.floor(Date.now() / 1000).toString();
    const orderNumber = `#${customOrderId}`;

    // Fetch the cart
    const cart = await CartModel.findById(cartId).populate({
        path: 'items.item',
        populate: { path: 'partner', select: '_id name' }
    });

    if (!cart || cart.items.length === 0) {
        throw new Error(CONSTANTS.CART_EMPTY);
    }

    const firstItem = cart.items[0].item;
    const partnerId = firstItem.partner._id;

    // Initialize the transaction history
    const transactionHistory = [{
        type: "Order Placed",
        date: new Date(),
        amount: cart.totalPrice,
        status: "Completed"
    }];

    // Check if deliveryAddress is required
    const requiresDeliveryAddress = cart.items.some(
        item => item.item.itemType === 'food' || item.item.itemType === 'product'
    );

    // Create the order object with conditional deliveryAddress
    const orderData = {
        user: userId,
        partner: partnerId,
        items: cart.items,
        totalPrice: cart.totalPrice,
        subtotal: cart.subtotal,
        tax: cart.tax,
        deliveryCharge: cart.deliveryCharge,
        paymentMethod: paymentMethod,
        orderNote: orderNote,
        orderId: customOrderId,
        orderNumber: orderNumber,
        orderStatus: 'pending',
        transactionHistory: transactionHistory,
    };

    if (requiresDeliveryAddress) {
        orderData.deliveryAddress = cart.deliveryAddress;
    }

    const order = new OrderModel(orderData);

    await order.save();

    // Handle online payment if required
    if (paymentMethod === 'online') {
        const paymentResult = await processOnlinePayment(order);
        if (!paymentResult.success) {
            order.orderStatus = 'payment_failed';
            await order.save();
            throw new Error(CONSTANTS.PAYMENT_FAILED);
        }
        order.orderStatus = 'paid';
        order.transactionHistory.push({
            type: "Payment Completed",
            date: new Date(),
            amount: order.totalPrice,
            status: "Completed"
        });
        await order.save();
    }

    // Clear the cart
    cart.items = [];
    cart.totalPrice = 0;
    await cart.save();

    return order;
};

// Mock online payment processing (this should be replaced with real payment logic)
const processOnlinePayment = async (order) => {
    // Simulate an online payment (replace with actual payment gateway integration)
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve({ success: true });  // Simulate successful payment
        }, 2000);  // Simulate a 2-second delay for the payment process
    });
};


const updateOrderStatus = async (orderId, orderStatus) => {
    const order = await OrderModel.findById(orderId);
    if (!order) throw { statusCode: 404, message: CONSTANTS.ORDER_NOT_FOUND };

    if (order.orderStatus === 'delivered' || order.orderStatus === 'cancelled') {
        throw { statusCode: 400, message: CONSTANTS.UPDATE_STATUS_AFTER_DELIVERD_ERROR };
    }

    // Update order status and add to transaction history
    order.orderStatus = orderStatus;
    order.transactionHistory.push({
        type: `Order ${orderStatus.charAt(0).toUpperCase() + orderStatus.slice(1)}`,  // Capitalize status
        date: new Date(),
        amount: order.totalPrice,
        status: "Completed"
    });

    await order.save();
    return order;
};

// Get all orders by user
const getOrdersByUser = async (userId) => {
    const orders = await OrderModel.find({ user: userId })
        .populate('items.item')
        .sort({ createdAt: -1 });
    return orders;
};

// Get order by ID
const getOrderById = async (orderId) => {
    const order = await OrderModel.findById(orderId)
        .populate('user', '_id name email phone')
        .populate('items.item')
        .populate('orderStatus');
    return order;
};

// Get pending food requests for the partner
const getPendingFoodRequests = async (partnerId) => {
    const orders = await OrderModel.find({
        partner: partnerId,
        orderStatus: 'pending'
    }).populate({
        path: 'items.item',
        select: 'itemType dishPrice', // Include fields you need from Item model
        match: { itemType: 'food' }
    });
    return orders.filter(order => order.items.some(item => item.item));
};

// Get pending room requests for the partner
const getPendingRoomRequests = async (partnerId) => {
    // Fetch orders with 'pending' status and populate item details
    const orders = await OrderModel.find({
        partner: partnerId,
        orderStatus: 'pending'
    }).populate({
        path: 'items.item',
        select: 'itemType roomPrice', // Include fields you need from Item model
        match: { itemType: 'room' } // Filter items by room type
    });

    // Filter out orders where items array is empty after population
    return orders.filter(order => order.items.some(item => item.item));
};

// Get pending product requests for the partner
const getPendingProductRequests = async (partnerId) => {
    const orders = await OrderModel.find({
        partner: partnerId,
        orderStatus: 'pending'
    }).populate('items.item');

    // Filter orders to include only those that contain product items
    const productOrders = orders.filter(order =>
        order.items.some(item => item.item && item.item.itemType === 'product')
    );

    return productOrders;
};

// Update the status of an order/request (Accept or Reject)
const updatePartnerRequestStatus = async (orderId, partnerId, partnerResponse) => {
    const order = await OrderModel.findOne({ _id: orderId, partner: partnerId });

    if (!order) {
        throw new Error("Order not found or unauthorized access");
    }

    if (order.orderStatus !== 'pending') {
        throw new Error("Order is no longer in a pending state");
    }

    // Update order status and partner response
    order.orderStatus = partnerResponse === 'accepted' ? 'accepted' : 'rejected';
    order.partnerResponse = partnerResponse;

    // Log the response in transaction history
    order.transactionHistory.push({
        type: `Request ${partnerResponse.charAt(0).toUpperCase() + partnerResponse.slice(1)}`,
        date: new Date(),
        amount: order.totalPrice,
        status: partnerResponse === 'accepted' ? 'Completed' : 'Rejected'
    });

    await order.save();
    return order;
};

// Update delivery partner 
const updateDeliveryPartner = async (orderId, deliveryPartner) => {
    const order = await OrderModel.findById(orderId);
    if (!order) throw new Error('Order not found');

    order.deliveryPartner = deliveryPartner;
    order.orderStatus = 'out_for_delivery'; // Change status to 'Out for Delivery'
    await order.save();

    return order;
};

// Cancel an order
const cancelOrder = async (orderId, reason) => {
    const order = await OrderModel.findById(orderId);
    if (!order) { throw new Error(CONSTANTS.ORDER_NOT_FOUND) }
    order.status = 'cancelled';
    order.cancellationReason = reason;
    await order.save();
    return order;
};

// Track order status
const trackOrder = async (orderId) => {
    const order = await OrderModel.findById(orderId)
        .populate({
            path: 'items.item',
            select: 'itemType dishName productName, productDescription images',
        })
        .populate('user', 'name email')
        .populate('partner', 'name businessName');

    order.items = order.items.map(item => {
        const itemData = item.item;
        let itemName = '';
        if (itemData.itemType === 'food') {
            itemName = itemData.dishName;
        } else if (itemData.itemType === 'product') {
            itemName = itemData.productName && itemData.productDescription;
        }

        return {
            ...item.toObject(),
            item: {
                ...itemData.toObject(),
                itemName,
            },
        };
    });

    return order;
};

// Get Orders Of All Users
const queryOrder = async (options) => {
    var matchCondition = {};
    // Filter by userId
    if (options.userId && options.userId !== 'undefined') { matchCondition.user = new mongoose.Types.ObjectId(String(options.userId)) }
    // Filter by partnerId
    if (options.partnerId && options.partnerId !== 'undefined') { matchCondition.partner = new mongoose.Types.ObjectId(String(options.partnerId)) }

    // Filter by search query (orderId, user name, or email)
    if (options.search && options.search !== 'undefined') {
        matchCondition.$or = [
            { orderId: { $regex: '.*' + options.search + '.*', $options: 'i' } },
            { 'userDetails.name': { $regex: '.*' + options.search + '.*', $options: 'i' } },
            { 'userDetails.email': { $regex: '.*' + options.search + '.*', $options: 'i' } }
        ];
    }
    // Filter by status
    if (options.status && options.status !== 'undefined') { matchCondition.status = options.status }
    // Aggregation pipeline
    const aggregateQuery = [
        {
            $lookup: {
                from: 'users', // Join with the users collection for user details
                localField: 'user',
                foreignField: '_id',
                as: 'userDetails'
            }
        },
        { $unwind: '$userDetails' },
        {
            $lookup: {
                from: 'users', // Join with the users collection for partner details
                localField: 'partner',
                foreignField: '_id',
                as: 'partnerDetails'
            }
        },
        { $unwind: { path: '$partnerDetails', preserveNullAndEmptyArrays: true } }, // Unwind partnerDetails
        { $match: matchCondition }, // Apply match condition here
        {
            $lookup: {
                from: 'items', // Join with the items collection for item details
                localField: 'items.item',
                foreignField: '_id',
                as: 'itemDetails'
            }
        }
    ];
    // If filtering by itemType, add a match for itemType inside items
    if (options.itemType && options.itemType !== 'undefined') {
        aggregateQuery.push({
            $match: {
                'itemDetails.itemType': options.itemType
            }
        });
    }
    // Apply sorting
    const sortOption = {};
    if (options.sortBy && options.sortBy !== 'undefined') {
        sortOption[options.sortBy] = options.sortOrder === 'asc' ? 1 : -1;
    } else {
        sortOption['createdAt'] = -1;
    }
    aggregateQuery.push({ $sort: sortOption });

    const aggregateQueryPipeline = OrderModel.aggregate(aggregateQuery);
    const data = await OrderModel.aggregatePaginate(aggregateQueryPipeline, { page: options.page || 1, limit: options.limit || 10 });
    return data;
};

// Get Orders Of Users By userId
const getOrdersByUserIdAdmin = async (userId = null, search = '', sortBy = 'createdAt', sortOrder = 'desc', page = 1, limit = 10) => {
    const query = userId ? { user: userId } : {};
    if (search) {
        query.$or = [
            { 'user.name': { $regex: search, $options: 'i' } },
            { 'user.email': { $regex: search, $options: 'i' } }
        ];
    }
    const skip = (page - 1) * limit;
    const sortOptions = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
    const orders = await OrderModel.find(query)
        .populate('user', 'name email')
        .populate('items.item')
        .sort(sortOptions)
        .skip(skip)
        .limit(limit);
    const totalOrders = await OrderModel.countDocuments(query);
    return { orders, totalOrders };
};

// Get Orders Of Partner By partnerId
const getOrdersByPartnerId = async (partnerId, search = '', itemType = '', sortBy = 'createdAt', sortOrder = 'desc', page = 1, limit = 10) => {
    const query = { partner: partnerId };

    if (search) {
        query.$or = [
            { 'user.name': { $regex: search, $options: 'i' } },
            { 'user.email': { $regex: search, $options: 'i' } },
            { 'orderId': { $regex: search, $options: 'i' } }
        ];
    }

    const skip = (page - 1) * limit;
    const sortOptions = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const orders = await OrderModel.find(query)
        .populate({
            path: 'items.item',
            match: itemType ? { itemType: itemType } : {},
            populate: [
                { path: 'partner', select: 'name email' },
                { path: 'business', select: 'businessName status' },
                { path: 'businessType', select: 'name' }
            ]
        })
        .populate('user', 'name email')
        .sort(sortOptions)
        .skip(skip)
        .limit(limit);

    const filteredOrders = orders.filter(order => order.items.some(item => item.item));
    const totalOrders = filteredOrders.length;

    return { orders: filteredOrders, totalOrders };
};

const getHistoryByCategory = async (userId, category, status, page = 1, limit = 10) => {
    const validCategories = ['restaurants', 'hotels', 'products', 'dineout'];
    let query = { user: userId };
    if (status) query.orderStatus = status;

    if (!validCategories.includes(category)) {
        throw new Error(`Invalid category specified. Valid categories are: ${validCategories.join(', ')}`);
    }

    let results;
    switch (category) {
        case 'restaurants': {
            results = await OrderModel.paginate(query, {
                populate: {
                    path: 'items.item',
                    match: { itemType: 'food' },
                    select: 'dishName dishDescription dishPrice'
                },
                page,
                limit,
                lean: true
            });
            results.docs = results.docs.filter(order => order.items.some(item => item.item));
            break;
        }
        case 'hotels': {
            results = await OrderModel.paginate(query, {
                populate: {
                    path: 'items.item',
                    match: { itemType: 'room' },
                    select: 'roomName roomDescription roomPrice roomCapacity checkIn checkOut'
                },
                page,
                limit,
                lean: true
            });
            results.docs = results.docs.filter(order => order.items.some(item => item.item));
            break;
        }
        case 'products': {
            results = await OrderModel.paginate(query, {
                populate: {
                    path: 'items.item',
                    match: { itemType: 'product' },
                    select: 'productName productDescription productFeatures variants'
                },
                page,
                limit,
                lean: true
            });
            results.docs = results.docs.filter(order => order.items.some(item => item.item));
            break;
        }
        case 'dineout': {
            results = await DineOutRequest.paginate(query, {
                page,
                limit,
                lean: true
            });
            break;
        }
        default:
            throw new Error("Invalid category specified.");
    }

    return {
        statusCode: 200,
        data: results,
        message: `${category.charAt(0).toUpperCase() + category.slice(1)} history retrieved successfully.`
    };
};

const getAllHistory = async (userId) => {
    // Fetch orders with items separated by type (food, room, product)
    const orders = await OrderModel.find({ user: userId })
        .populate({
            path: 'items.item',
            select: 'itemType dishName productName roomName',
        });

    // Filter items within orders by type for structured response
    const foodOrders = orders.filter(order =>
        order.items.some(item => item.item?.itemType === 'food')
    );
    const roomBookings = orders.filter(order =>
        order.items.some(item => item.item?.itemType === 'room')
    );
    const productOrders = orders.filter(order =>
        order.items.some(item => item.item?.itemType === 'product')
    );

    // Fetch dine-out reservations
    const dineOutReservations = await DineOutModel.find({ user: userId });

    return { foodOrders, roomBookings, productOrders, dineOutReservations };
};

const getTransactionHistoryByOrderId = async (orderId) => {
    const order = await OrderModel.findById(orderId)
        .populate('user', 'name email phone')
        .populate('partner', 'name email')
        .populate({
            path: 'items.item',
            populate: {
                path: 'business businessType',
                select: 'businessName name'
            }
        })
        .select('transactionHistory refundDetails totalPrice subtotal tax deliveryCharge orderStatus paymentMethod deliveryAddress orderNote createdAt updatedAt items orderId');

    if (!order) {
        throw new Error(CONSTANTS.ORDER_NOT_FOUND);
    }

    // Map transaction history and add transactionId
    const filteredTransactionHistory = order.transactionHistory.map(transaction => ({
        transactionId: transaction._id, // Assuming _id is available as a unique identifier for each transaction
        type: transaction.type,
        date: transaction.date,
        amount: transaction.amount,
        status: transaction.status,
    }));

    // Extract refund details as a separate field
    const refundDetails = order.refundDetails && order.refundDetails.status !== 'none' ? {
        reason: order.refundDetails.reason,
        status: order.refundDetails.status,
        requestedDate: order.refundDetails.requestedDate,
        approvedDate: order.refundDetails.approvedDate,
        amount: order.refundDetails.amount,
        bankDetails: order.refundDetails.bankDetails
    } : null;

    return {
        orderId: order.orderId, // Ensure orderId is included
        orderNumber: order.orderNumber,
        user: order.user,
        partner: order.partner,
        items: order.items.map(item => ({
            itemId: item.item._id,
            itemType: item.item.itemType,
            name: item.item.productName || item.item.dishName || item.item.roomName,
            description: item.item.productDescription || item.item.dishDescription || item.item.roomDescription,
            quantity: item.quantity,
            selectedSize: item.selectedSize || null,
            selectedColor: item.selectedColor || null
        })),
        totalPrice: order.totalPrice,
        subtotal: order.subtotal,
        tax: order.tax,
        deliveryCharge: order.deliveryCharge,
        orderStatus: order.orderStatus,
        paymentMethod: order.paymentMethod,
        deliveryAddress: order.deliveryAddress,
        orderNote: order.orderNote,
        transactionHistory: filteredTransactionHistory, // Updated transaction history with transactionId
        refundDetails,  // Separate refund details
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
    };
};

const getAllTransactionHistory = async ({ page = 1, limit = 10, itemType, status, search, sortBy, sortOrder }) => {
    // Parse page and limit to integers
    const pageNumber = parseInt(page, 10);
    const limitNumber = parseInt(limit, 10);

    const query = {};

    // Apply order status filter if provided
    if (status) {
        query['orderStatus'] = status;
    }

    // Search filter for user or partner name, and orderId
    if (search) {
        query['$or'] = [
            { 'user.name': { $regex: search, $options: 'i' } },
            { 'partner.name': { $regex: search, $options: 'i' } },
            { 'orderId': { $regex: search, $options: 'i' } }
        ];
    }

    // Aggregation pipeline
    const aggregateQuery = [
        { $match: query },

        // $lookup to populate user details
        {
            $lookup: {
                from: 'users',
                localField: 'user',
                foreignField: '_id',
                as: 'userDetails'
            }
        },
        { $unwind: '$userDetails' }, // Unwind to access user fields directly

        // $lookup to populate partner details
        {
            $lookup: {
                from: 'users',
                localField: 'partner',
                foreignField: '_id',
                as: 'partnerDetails'
            }
        },
        { $unwind: '$partnerDetails' }, // Unwind to access partner fields directly

        // $lookup with itemType filtering in the pipeline
        {
            $lookup: {
                from: 'items',
                let: { itemIds: '$items.item' },
                pipeline: [
                    { $match: { $expr: { $in: ['$_id', '$$itemIds'] } } },
                    ...(itemType ? [{ $match: { itemType: itemType } }] : [])
                ],
                as: 'filteredItems'
            }
        },

        // Ensure orders have at least one item of the specified type
        { $match: { filteredItems: { $ne: [] } } },

        // Sort and paginate results
        { $sort: { [sortBy]: sortOrder === 'asc' ? 1 : -1 } },
        { $skip: (pageNumber - 1) * limitNumber },
        { $limit: limitNumber },

        // Project only relevant fields
        {
            $project: {
                transactionId: "$_id",
                createdAt: 1,
                userName: "$userDetails.name",
                orderId: 1,
                amount: "$totalPrice",
                status: "$orderStatus"
            }
        }
    ];

    // Execute the aggregation
    const orderSummaries = await OrderModel.aggregate(aggregateQuery);

    return {
        data: orderSummaries,
        totalOrders: orderSummaries.length,
        currentPage: pageNumber,
        totalPages: Math.ceil(orderSummaries.length / limitNumber)
    };
};

const requestRefundForItems = async (orderId, itemIds, reason, processedBy, bankDetails) => {
    const order = await OrderModel.findById(orderId).populate('items.item');
    if (!order) throw new Error(CONSTANTS.ORDER_NOT_FOUND);

    const exactRefundAmount = order.items
        .filter(item => itemIds.includes(item.item._id.toString()) && item.item.itemType === 'product')
        .reduce((total, item) => {
            let price;
            if (item.item.itemType === 'product') {
                const variant = item.item.variants.find(v =>
                    v.size === item.selectedSize && v.color === item.selectedColor
                );
                if (variant) {
                    price = variant.productPrice;
                } else {
                    throw new Error("Variant not found for selected options during refund calculation.");
                }
            } else {
                price = item.item.dishPrice || item.item.roomPrice;
            }
            if (!price) throw new Error("Price not found for item during refund calculation.");
            return total + (price * item.quantity);
        }, 0);

    if (isNaN(exactRefundAmount) || exactRefundAmount <= 0) {
        throw new Error("Invalid refund amount calculated.");
    }

    // Update the refund status and details at the root level
    order.refundStatus = 'pending';
    order.refundDetails = {
        reason: reason,
        status: 'pending',
        requestedDate: new Date(),
        amount: exactRefundAmount,
        bankDetails: {
            country: bankDetails.country,
            bankName: bankDetails.bankName,
            accountName: bankDetails.accountName,
            accountNumber: bankDetails.accountNumber,
            ifscCode: bankDetails.ifscCode
        }
    };

    // Add a record in the transaction history as well
    order.transactionHistory.push({
        type: "Refund Requested",
        date: new Date(),
        amount: exactRefundAmount,
        status: "pending"
    });

    await order.save();
    return order;
};

const processRefundDecision = async (orderId, decision, partnerId, bankDetails = {}) => {
    const order = await OrderModel.findOne({ _id: orderId, partner: partnerId });
    if (!order) throw new Error("Order not found or unauthorized access");

    const lastTransaction = order.transactionHistory
        .filter(th => th && th.type === "Refund Requested")
        .pop();

    if (!lastTransaction || lastTransaction.status !== "pending") {
        throw new Error("Refund request is either not pending or already processed.");
    }

    const isAccepted = decision === 'accept';
    order.refundStatus = isAccepted ? 'approved' : 'rejected';

    // Add a new transaction history entry for the refund decision
    order.transactionHistory.push({
        type: `Refund ${isAccepted ? 'Approved' : 'Rejected'}`,
        date: new Date(),
        amount: lastTransaction.amount,
        status: isAccepted ? 'Completed' : 'Rejected',
        refundDetails: isAccepted && lastTransaction.refundDetails ? {
            bankDetails: lastTransaction.refundDetails.bankDetails || {}, // Check if bankDetails exists
            reason: lastTransaction.refundDetails.reason || ""
        } : {}
    });

    await order.save();
    return order;
};

// New Functions for Return/Exchange Functionality

const initiateReturnOrExchange = async (orderId, itemIds, reason, action, processedBy) => {
    const order = await OrderModel.findById(orderId).populate('items.item');
    if (!order) throw new Error(CONSTANTS.ORDER_NOT_FOUND);

    // Ensure transactionHistory is initialized as an array
    if (!Array.isArray(order.transactionHistory)) {
        order.transactionHistory = [];
    }

    order.transactionHistory.push({
        type: action === 'exchange' ? 'Exchange Requested' : 'Return Requested',
        date: new Date(),
        amount: order.totalPrice,
        status: "pending",
        returnDetails: {
            reason: reason,
            processedBy: processedBy,
            action: action,
            items: itemIds
        }
    });

    await order.save();
    return order;
};

const processReturnDecision = async (orderId, decision, partnerId) => {
    const order = await OrderModel.findOne({ _id: orderId, partner: partnerId });
    if (!order) throw new Error("Order not found or unauthorized access");

    const lastTransaction = order.transactionHistory
        .filter(th => th.type.startsWith("Return") || th.type.startsWith("Exchange"))
        .pop();

    if (!lastTransaction || lastTransaction.status !== "pending") {
        throw new Error("Return/Exchange request is either not pending or already processed.");
    }

    const isAccepted = decision === 'accept';
    order.returnStatus = isAccepted ? 'approved' : 'rejected';

    order.transactionHistory.push({
        type: `${lastTransaction.type.split(' ')[0]} ${isAccepted ? 'Approved' : 'Rejected'}`,
        date: new Date(),
        amount: lastTransaction.amount,
        status: isAccepted ? 'Completed' : 'Rejected',
    });

    await order.save();
    return order;
};

// Get Partner Transactions
const getPartnerTransactionList = async (partnerId, timeFilter, page = 1, limit = 10) => {
    // Convert partnerId to ObjectId, ensuring it’s a string
    const matchCondition = { partner: new mongoose.Types.ObjectId(String(partnerId)) };
    const currentDate = new Date();
    let startDate;

    // Set the date filter based on timeFilter
    if (timeFilter === 'month') {
        startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    } else if (timeFilter === 'week') {
        const startOfWeek = currentDate.getDate() - currentDate.getDay();
        startDate = new Date(currentDate.setDate(startOfWeek));
    } else if (timeFilter === 'year') {
        startDate = new Date(currentDate.getFullYear(), 0, 1);
    }

    // Add date filtering only if startDate is set
    if (startDate) {
        matchCondition['transactionHistory.date'] = { $gte: startDate, $lte: currentDate };
    }

    // Aggregate transactions within the specified time range
    const transactions = await OrderModel.aggregate([
        { $match: matchCondition },
        { $unwind: '$transactionHistory' },
        {
            $match: startDate ? { 'transactionHistory.date': { $gte: startDate, $lte: currentDate } } : {}
        },
        {
            $project: {
                orderId: 1,
                transactionId: "$transactionHistory._id",
                type: "$transactionHistory.type",
                date: "$transactionHistory.date",
                amount: "$transactionHistory.amount",
                status: "$transactionHistory.status"
            }
        },
        { $sort: { date: -1 } }
    ]);

    // Pagination calculations
    const totalDocs = transactions.length;
    const totalPages = Math.ceil(totalDocs / limit);
    const currentPage = Math.min(page, totalPages); // Ensures current page does not exceed total pages
    const skipIndex = (currentPage - 1) * limit;
    const paginatedTransactions = transactions.slice(skipIndex, skipIndex + limit);

    // Response structure
    return {
        statusCode: 200,
        message: CONSTANTS.LIST,
        data: {
            docs: paginatedTransactions,
            totalDocs: totalDocs,
            limit: limit,
            totalPages: totalPages,
            page: currentPage,
            pagingCounter: skipIndex + 1,
            hasPrevPage: currentPage > 1,
            hasNextPage: currentPage < totalPages,
            prevPage: currentPage > 1 ? currentPage - 1 : null,
            nextPage: currentPage < totalPages ? currentPage + 1 : null
        }
    };
};

module.exports = {
    createOrder,
    processOnlinePayment,
    updateOrderStatus,
    getOrdersByUser,
    getOrderById,
    getPendingFoodRequests,
    getPendingRoomRequests,
    getPendingProductRequests,
    updatePartnerRequestStatus,
    updateDeliveryPartner,
    cancelOrder,
    trackOrder,
    queryOrder,
    getOrdersByUserIdAdmin,
    getOrdersByPartnerId,
    getHistoryByCategory,
    getAllHistory,
    getTransactionHistoryByOrderId,
    getAllTransactionHistory,
    requestRefundForItems,
    processRefundDecision,
    initiateReturnOrExchange,
    processReturnDecision,
    getPartnerTransactionList
};