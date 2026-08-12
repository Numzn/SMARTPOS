const prisma = require('../lib/prisma')
const vsdcService = require('./vsdcService')
const endpointAdapter = require('../lib/vsdc-gateway/endpointAdapter')

/**
 * VSDC Item Composition — Section 6.5, POST /items/saveItemComposition.
 * OPTIONAL per the spec (unlike item save), so unlike Product's own
 * registration this never gates anything else: a composition row can be
 * added even if the VSDC submission fails, but the failure is recorded
 * rather than silently dropped.
 *
 * One row = one component of a parent (finished) product, e.g. "Product A
 * contains 2 units of Product B." A parent with several ingredients has
 * several rows. There is no update/delete endpoint in the spec — only
 * "save" — so removal is local-only (removeComponent below never calls
 * VSDC); re-adding the same pair with a new quantity re-submits a fresh
 * "save" (the spec's semantics for that case aren't documented, but a save
 * is the only available primitive).
 */
class ItemCompositionService {
  async listComponents(parentProductId) {
    return prisma.productComposition.findMany({
      where: { parentProductId },
      include: {
        componentProduct: { select: { id: true, name: true, sku: true, unit: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
  }

  async addComponent(parentProductId, componentProductId, quantity) {
    if (parentProductId === componentProductId) {
      throw new Error('A product cannot be a component of itself')
    }
    const numericQuantity = parseFloat(quantity)
    if (!(numericQuantity > 0)) {
      throw new Error('Quantity must be greater than 0')
    }

    const [parent, component] = await Promise.all([
      prisma.product.findUnique({ where: { id: parentProductId } }),
      prisma.product.findUnique({ where: { id: componentProductId } }),
    ])
    if (!parent) throw new Error('Parent product not found')
    if (!component) throw new Error('Component product not found')
    // itemCd/cpstItemCd on the VSDC payload are the products' SKUs (same
    // convention as itemManagement.js's item save) — a product with no SKU
    // has nothing to send ZRA.
    if (!parent.sku) throw new Error(`Parent product "${parent.name}" has no SKU — cannot register composition with VSDC`)
    if (!component.sku) throw new Error(`Component product "${component.name}" has no SKU — cannot register composition with VSDC`)

    const row = await prisma.productComposition.upsert({
      where: { parentProductId_componentProductId: { parentProductId, componentProductId } },
      create: { parentProductId, componentProductId, quantity: numericQuantity },
      update: { quantity: numericQuantity, zraRegistrationStatus: 'PENDING', zraRegistrationError: null },
    })

    const vsdcPayload = {
      tpin: process.env.BUSINESS_TPIN,
      bhfId: process.env.BRANCH_ID || '000',
      itemCd: parent.sku,
      cpstItemCd: component.sku,
      cpstQty: numericQuantity,
      regrId: 'SYSTEM',
      regrNm: 'SYSTEM',
    }

    try {
      if (!vsdcService.isInitialized) {
        await vsdcService.initialize()
      }
      const response = await vsdcService.makeAuthenticatedRequest(
        'POST',
        endpointAdapter.path('itemComposition'),
        vsdcPayload
      )
      if (!response.success || response.data?.resultCd !== '000') {
        throw new Error(response.data?.resultMsg || 'Unknown VSDC error')
      }
      return prisma.productComposition.update({
        where: { id: row.id },
        data: { zraRegistrationStatus: 'REGISTERED', zraRegisteredAt: new Date(), zraRegistrationError: null },
        include: { componentProduct: { select: { id: true, name: true, sku: true, unit: true } } },
      })
    } catch (error) {
      await prisma.productComposition.update({
        where: { id: row.id },
        data: { zraRegistrationStatus: 'FAILED', zraRegistrationError: error.message },
      })
      const wrapped = new Error(error.message)
      wrapped.compositionId = row.id
      throw wrapped
    }
  }

  // Local-only — no VSDC delete/update-composition endpoint exists in the
  // spec (only "save"). Removing a component here doesn't tell ZRA
  // anything; that's a real gap, not an oversight, documented in
  // zra-self-checklist.md item 9*.
  async removeComponent(compositionId) {
    return prisma.productComposition.delete({ where: { id: compositionId } })
  }
}

module.exports = new ItemCompositionService()
