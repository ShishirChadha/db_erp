import { supabaseAdmin } from './supabase/service'

export async function insertAccessoryMovement(input: {
  accessoryId: string
  movementType: 'in' | 'out' | 'adjustment' | 'return_in'
  quantityChange: number
  saleId?: string | null
  serialNumber?: string | null
  notes?: string | null
  createdBy: string
}) {
  return supabaseAdmin.from('accessory_movements').insert({
    accessory_id: input.accessoryId,
    movement_type: input.movementType,
    quantity_change: input.quantityChange,
    sale_id: input.saleId || null,
    serial_number: input.serialNumber || null,
    notes: input.notes || null,
    created_by: input.createdBy,
  })
}
