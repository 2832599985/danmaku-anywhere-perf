import { factory } from '@/factory'
import { roomsController } from './controller'

export const roomsRouter = factory.createApp()

roomsRouter.route('/', roomsController)
