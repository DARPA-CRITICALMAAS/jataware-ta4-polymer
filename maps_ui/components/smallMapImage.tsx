
import React, { useState } from 'react';

import { returnImageBufferUrl } from "./helpers"

function SmallMapImage({ cog_id, gcp, height }) {
    const [clipUrl, setClipUrl] = useState(returnImageBufferUrl(cog_id, gcp, height))

    function returnColor(arr) {
        return `rgb(${arr[0]},${arr[1]},${arr[2]} )`
    }
    function returnHeight() {
        return "220px"
    }

    return (
        <>
            {clipUrl &&
                <div
                    className='borderBox'
                    style={{
                        display: "grid",
                        justifyContent: "center",
                        alignContent: "center",
                        width: returnHeight(),
                        height: "220px",
                        background: returnColor(gcp.color)
                    }}>
                    <img
                        src={clipUrl}
                        alt="Loading Clipped Map..."
                        style={{

                            width: '200px',
                            height: '200px',
                            cursor: 'pointer'
                        }}
                    />
                </div>
            }
        </>
    )
}
export default SmallMapImage;