import { factory } from '@/factory'
import { communityRouter } from './controller'

export const communityApiRouter = factory.createApp()

communityApiRouter.route('/', communityRouter)
