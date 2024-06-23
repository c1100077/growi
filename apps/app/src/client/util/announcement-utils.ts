import type { IUserHasId } from '@growi/core';

import { type IAnnouncement } from '~/interfaces/announcement';

import { apiv3Post } from './apiv3-client';
import { toastError } from './toastr';


export const createAnnouncement = async(announcement: IAnnouncement, sender: IUserHasId, pageId: string, receivers: IUserHasId[]): Promise<void> => {

  try {
    await apiv3Post('/announcement', {
      announcement, sender, pageId, receivers,
    });
  }
  catch (err) {
    toastError(err);
  }

};
