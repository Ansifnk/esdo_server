import { prisma } from '../src/lib/prisma';
import * as crypto from 'crypto';

export function generateCustomerReferralCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

async function main() {
  console.log('Seeding initial Reward Settings and Referral Slabs...');

  // 1. Reward Settings
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
    console.log('Created initial RewardSetting');
  } else {
    console.log('RewardSetting already exists');
  }

  // 2. Referral Reward Slabs
  const initialSlabs = [
    {
      referralCount: 1,
      coinsEarned: 200,
      hasMilestoneReward: false,
      milestoneTitle: null,
      milestoneType: null,
      milestoneValue: null,
    },
    {
      referralCount: 2,
      coinsEarned: 350,
      hasMilestoneReward: false,
      milestoneTitle: null,
      milestoneType: null,
      milestoneValue: null,
    },
    {
      referralCount: 3,
      coinsEarned: 425,
      hasMilestoneReward: false,
      milestoneTitle: null,
      milestoneType: null,
      milestoneValue: null,
    },
    {
      referralCount: 4,
      coinsEarned: 525,
      hasMilestoneReward: false,
      milestoneTitle: null,
      milestoneType: null,
      milestoneValue: null,
    },
    {
      referralCount: 5,
      coinsEarned: 600,
      hasMilestoneReward: true,
      milestoneTitle: 'Free service unlocked',
      milestoneType: 'FREE_SERVICE_VOUCHER',
      milestoneValue: 500,
    },
    {
      referralCount: 10,
      coinsEarned: 1000,
      hasMilestoneReward: true,
      milestoneTitle: 'Free service unlocked',
      milestoneType: 'FREE_SERVICE_VOUCHER',
      milestoneValue: 750,
    },
    {
      referralCount: 15,
      coinsEarned: 1425,
      hasMilestoneReward: true,
      milestoneTitle: 'Free service unlocked',
      milestoneType: 'FREE_SERVICE_VOUCHER',
      milestoneValue: 1000,
    },
  ];

  for (const slab of initialSlabs) {
    await prisma.referralRewardSlab.upsert({
      where: { referralCount: slab.referralCount },
      update: {},
      create: slab,
    });
  }
  console.log('Upserted ReferralRewardSlabs');

  // 3. Backfill customer referral codes if null
  const customersWithoutCode = await prisma.customer.findMany({
    where: { referralCode: null },
  });

  for (const customer of customersWithoutCode) {
    let uniqueCode = generateCustomerReferralCode();
    while (await prisma.customer.findUnique({ where: { referralCode: uniqueCode } })) {
      uniqueCode = generateCustomerReferralCode();
    }

    await prisma.customer.update({
      where: { id: customer.id },
      data: { referralCode: uniqueCode },
    });
  }
  if (customersWithoutCode.length > 0) {
    console.log(`Backfilled referral codes for ${customersWithoutCode.length} customers.`);
  }

  console.log('Seeding rewards & referral completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(async () => {
    await prisma.$disconnect();
  });
