import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import AppResponse from '../../models/AppResponse';
import AppError from '../../models/AppError';

/**
 * Helper to calculate subtotal, discount, and total for a cart
 */
async function calculateCartSummary(cart: any) {
  const items = cart.items || [];
  let subtotal = 0;

  for (const item of items) {
    const itemPrice = item.price || item.service?.discountPrice || item.service?.price || item.package?.discountPrice || item.package?.price || 0;
    subtotal += itemPrice;
  }

  let discount = 0;
  if (cart.couponCode) {
    // Check if there is an active offer coupon matching couponCode
    const offer = await prisma.offer.findFirst({
      where: {
        couponCode: { equals: cart.couponCode, mode: 'insensitive' },
        isActive: true,
      },
    });

    if (offer) {
      if (offer.discountType === 'PERCENTAGE') {
        discount = (subtotal * offer.discountValue) / 100;
      } else if (offer.discountType === 'FIXED') {
        discount = offer.discountValue;
      }
    }
  }

  discount = Math.min(discount, subtotal);
  const total = Math.max(0, subtotal - discount);

  return {
    subtotal,
    discount,
    total,
  };
}

/**
 * GET /api/cart
 * Get current customer's cart
 */
export const getCart = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication required', 401);
    }

    let cart = await prisma.cart.findUnique({
      where: { customerId },
      include: {
        items: {
          include: {
            service: true,
            package: true,
            staff: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: { customerId },
        include: {
          items: {
            include: {
              service: true,
              package: true,
              staff: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    }

    const summary = await calculateCartSummary(cart);

    res.json(
      new AppResponse('Cart retrieved successfully', {
        cart,
        summary,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to retrieve cart', {}, statusCode));
  }
};

/**
 * POST /api/cart/add
 * Add item to cart
 */
export const addToCart = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication required', 401);
    }

    const { serviceId, packageId, staffId, date, timeSlot } = req.body;

    if (!serviceId && !packageId) {
      throw new AppError('Either serviceId or packageId is required', 400);
    }

    let price = 0;
    if (serviceId) {
      const service = await prisma.service.findUnique({ where: { id: serviceId } });
      if (!service) {
        throw new AppError('Service not found', 404);
      }
      price = service.discountPrice > 0 ? service.discountPrice : service.price;
    } else if (packageId) {
      const pkg = await prisma.package.findUnique({ where: { id: packageId } });
      if (!pkg) {
        throw new AppError('Package not found', 404);
      }
      price = pkg.discountPrice > 0 ? pkg.discountPrice : pkg.price;
    }

    let cart = await prisma.cart.findUnique({
      where: { customerId },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: { customerId },
      });
    }

    const newItem = await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        serviceId: serviceId || null,
        packageId: packageId || null,
        staffId: staffId || null,
        date: date || 'Today, 15 June',
        timeSlot: timeSlot || '12:00 PM',
        price,
      },
      include: {
        service: true,
        package: true,
        staff: true,
      },
    });

    // Fetch full updated cart
    const updatedCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          include: {
            service: true,
            package: true,
            staff: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    const summary = await calculateCartSummary(updatedCart);

    res.json(
      new AppResponse('Item added to cart successfully', {
        item: newItem,
        cart: updatedCart,
        summary,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to add item to cart', {}, statusCode));
  }
};

/**
 * DELETE /api/cart/items/:itemId
 * Remove item from cart
 */
export const removeCartItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication required', 401);
    }

    const itemId = String(req.params.itemId);

    const cart = await prisma.cart.findUnique({
      where: { customerId },
    });

    if (!cart) {
      throw new AppError('Cart not found', 404);
    }

    const item = await prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
    });

    if (!item) {
      throw new AppError('Item not found in cart', 404);
    }

    await prisma.cartItem.delete({
      where: { id: itemId },
    });

    const updatedCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          include: {
            service: true,
            package: true,
            staff: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    const summary = await calculateCartSummary(updatedCart);

    res.json(
      new AppResponse('Item removed from cart', {
        cart: updatedCart,
        summary,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to remove item', {}, statusCode));
  }
};

/**
 * POST /api/cart/coupon
 * Apply or clear coupon code
 */
export const applyCoupon = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication required', 401);
    }

    const { couponCode } = req.body;

    let cart = await prisma.cart.findUnique({
      where: { customerId },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: { customerId },
      });
    }

    // Update couponCode on cart
    cart = await prisma.cart.update({
      where: { id: cart.id },
      data: { couponCode: couponCode || '' },
      include: {
        items: {
          include: {
            service: true,
            package: true,
            staff: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    const summary = await calculateCartSummary(cart);

    res.json(
      new AppResponse(couponCode ? 'Coupon applied successfully' : 'Coupon removed', {
        cart,
        summary,
      })
    );
  } catch (error: any) {
    const statusCode = error instanceof AppError ? error.status : (error.status || 500);
    res.json(new AppResponse(error.message || 'Failed to apply coupon', {}, statusCode));
  }
};
