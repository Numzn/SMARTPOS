/**
 * Product ZRA registration persistence (no service imports — avoids circular deps).
 */

const prisma = require('./prisma');

function getProductClassification(product) {
  return product.zraItemClassification || product.zraClassificationCode || null;
}

async function markRegistrationFailed(productId, errorMessage) {
  await prisma.product.update({
    where: { id: productId },
    data: {
      zraRegistrationStatus: 'FAILED',
      zraRegistrationError: errorMessage,
      zraRegisteredAt: null,
    },
  });
}

async function markRegistrationSuccess(productId, vsdcResponse) {
  await prisma.product.update({
    where: { id: productId },
    data: {
      zraRegistrationStatus: 'REGISTERED',
      zraRegisteredAt: new Date(),
      zraRegistrationError: null,
      vsdcItemResponse: vsdcResponse ?? undefined,
    },
  });
}

module.exports = {
  getProductClassification,
  markRegistrationFailed,
  markRegistrationSuccess,
};
