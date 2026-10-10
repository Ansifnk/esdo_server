import { prisma } from '../../lib/prisma';
import AppError from '../../models/AppError';

let cachedSettings: any = null;
let cacheExpiry: number = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute in-memory cache

export const rewardSettingService = {
  /**
   * Invalidate settings cache
   */
  invalidateCache() {
    cachedSettings = null;
    cacheExpiry = 0;
  },

  /**
   * Get dynamic reward settings (with fallback and caching)
   */
  async getSettings() {
    const now = Date.now();
    if (cachedSettings && now < cacheExpiry) {
      return cachedSettings;
    }

    let setting = await prisma.rewardSetting.findFirst();
    if (!setting) {
      setting = await prisma.rewardSetting.create({
        data: {
          isSpendRewardEnabled: true,
          spendAmountPerUnit: 100.0,
          coinsEarnedPerUnit: 1,
          coinRedemptionValue: 1.0,
          minRedemptionCoins: 100,
          maxRedemptionPercentage: 20.0,
          allowCombineWithCoupon: true,
          spendCoinExpiryMonths: 12,

          isReferralEnabled: true,
          referredUserDiscountAmount: 125.0,
          referredUserMinOrderAmount: 500.0,
          referredUserDiscountExpiryDays: 30,
          referralCoinExpiryMonths: 12,
          defaultReferralCoins: 200,
          shareMessageTemplate:
            'Sharing something I personally love ❤️ Es_Do has been amazing for salon & wellness services. Use my referral code {code} to get ₹{discount} OFF on your first booking. Visit now: {url}',
        },
      });
    }

    cachedSettings = setting;
    cacheExpiry = now + CACHE_TTL_MS;
    return setting;
  },

  /**
   * Update dynamic reward settings
   */
  async updateSettings(data: any) {
    const current = await this.getSettings();
    const updated = await prisma.rewardSetting.update({
      where: { id: current.id },
      data: {
        isSpendRewardEnabled: data.isSpendRewardEnabled ?? current.isSpendRewardEnabled,
        spendAmountPerUnit: data.spendAmountPerUnit !== undefined ? Number(data.spendAmountPerUnit) : current.spendAmountPerUnit,
        coinsEarnedPerUnit: data.coinsEarnedPerUnit !== undefined ? Number(data.coinsEarnedPerUnit) : current.coinsEarnedPerUnit,
        coinRedemptionValue: data.coinRedemptionValue !== undefined ? Number(data.coinRedemptionValue) : current.coinRedemptionValue,
        minRedemptionCoins: data.minRedemptionCoins !== undefined ? Number(data.minRedemptionCoins) : current.minRedemptionCoins,
        maxRedemptionPercentage: data.maxRedemptionPercentage !== undefined ? Number(data.maxRedemptionPercentage) : current.maxRedemptionPercentage,
        allowCombineWithCoupon: data.allowCombineWithCoupon ?? current.allowCombineWithCoupon,
        spendCoinExpiryMonths: data.spendCoinExpiryMonths !== undefined ? Number(data.spendCoinExpiryMonths) : current.spendCoinExpiryMonths,

        isReferralEnabled: data.isReferralEnabled ?? current.isReferralEnabled,
        referredUserDiscountAmount: data.referredUserDiscountAmount !== undefined ? Number(data.referredUserDiscountAmount) : current.referredUserDiscountAmount,
        referredUserMinOrderAmount: data.referredUserMinOrderAmount !== undefined ? Number(data.referredUserMinOrderAmount) : current.referredUserMinOrderAmount,
        referredUserDiscountExpiryDays: data.referredUserDiscountExpiryDays !== undefined ? Number(data.referredUserDiscountExpiryDays) : current.referredUserDiscountExpiryDays,
        referralCoinExpiryMonths: data.referralCoinExpiryMonths !== undefined ? Number(data.referralCoinExpiryMonths) : current.referralCoinExpiryMonths,
        defaultReferralCoins: data.defaultReferralCoins !== undefined ? Number(data.defaultReferralCoins) : current.defaultReferralCoins,
        shareMessageTemplate: data.shareMessageTemplate || current.shareMessageTemplate,
      },
    });

    this.invalidateCache();
    return updated;
  },

  /**
   * Get all active referral reward slabs
   */
  async getReferralSlabs() {
    return prisma.referralRewardSlab.findMany({
      orderBy: { referralCount: 'asc' },
    });
  },

  /**
   * Upsert a referral reward slab
   */
  async upsertReferralSlab(data: {
    id?: string;
    referralCount: number;
    coinsEarned: number;
    hasMilestoneReward?: boolean;
    milestoneTitle?: string | null;
    milestoneType?: string | null;
    milestoneValue?: number | null;
    isActive?: boolean;
  }) {
    if (data.id) {
      return prisma.referralRewardSlab.update({
        where: { id: data.id },
        data: {
          referralCount: Number(data.referralCount),
          coinsEarned: Number(data.coinsEarned),
          hasMilestoneReward: Boolean(data.hasMilestoneReward),
          milestoneTitle: data.milestoneTitle || null,
          milestoneType: data.milestoneType || null,
          milestoneValue: data.milestoneValue !== undefined && data.milestoneValue !== null ? Number(data.milestoneValue) : null,
          isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
        },
      });
    }

    return prisma.referralRewardSlab.upsert({
      where: { referralCount: Number(data.referralCount) },
      update: {
        coinsEarned: Number(data.coinsEarned),
        hasMilestoneReward: Boolean(data.hasMilestoneReward),
        milestoneTitle: data.milestoneTitle || null,
        milestoneType: data.milestoneType || null,
        milestoneValue: data.milestoneValue !== undefined && data.milestoneValue !== null ? Number(data.milestoneValue) : null,
        isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
      },
      create: {
        referralCount: Number(data.referralCount),
        coinsEarned: Number(data.coinsEarned),
        hasMilestoneReward: Boolean(data.hasMilestoneReward),
        milestoneTitle: data.milestoneTitle || null,
        milestoneType: data.milestoneType || null,
        milestoneValue: data.milestoneValue !== undefined && data.milestoneValue !== null ? Number(data.milestoneValue) : null,
        isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
      },
    });
  },

  /**
   * Delete a referral reward slab
   */
  async deleteReferralSlab(id: string) {
    return prisma.referralRewardSlab.delete({
      where: { id },
    });
  },
};
