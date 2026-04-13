import { factory } from '@/factory'
import { translate } from './routes'

export const translateRouter = factory.createApp()

translateRouter.route('/v1', translate)
